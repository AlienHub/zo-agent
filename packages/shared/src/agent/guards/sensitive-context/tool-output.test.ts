import { describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractToolResponseText, buildToolOutputRedaction } from './tool-output.ts';

const OPENAI_KEY = 'sk-proj-syntheticabcdefghijklmnopqrstuvwxyz123456';

function withWorkspace<T>(fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'tool-output-guard-'));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('extractToolResponseText', () => {
  it('returns plain strings unchanged', () => {
    expect(extractToolResponseText('hello world')).toBe('hello world');
  });

  it('joins stdout and stderr from Bash-shaped objects', () => {
    expect(extractToolResponseText({ stdout: 'out', stderr: 'err', interrupted: false })).toBe('out\nerr');
  });

  it('reads { text } and { file: { content } } shapes', () => {
    expect(extractToolResponseText({ text: 'abc' })).toBe('abc');
    expect(extractToolResponseText({ file: { content: 'file body', numLines: 1 } })).toBe('file body');
  });

  it('extracts only text blocks from content arrays, ignoring images', () => {
    const resp = { content: [{ type: 'text', text: 'visible' }, { type: 'image', source: { data: 'AAAA' } }] };
    expect(extractToolResponseText(resp)).toBe('visible');
  });

  it('returns empty string for unknown / pure-binary shapes (no JSON.stringify)', () => {
    expect(extractToolResponseText({ type: 'image', source: { data: 'b64dataxxxx' } })).toBe('');
    expect(extractToolResponseText(null)).toBe('');
    expect(extractToolResponseText(42)).toBe('');
  });
});

describe('buildToolOutputRedaction', () => {
  it('redacts secrets in built-in Bash output before the model sees it', () => {
    withWorkspace((root) => {
      const result = buildToolOutputRedaction({
        toolName: 'Bash',
        toolInput: { command: 'printenv' },
        toolResponse: `OPENAI_API_KEY=${OPENAI_KEY}`,
        sessionId: 's1',
        permissionMode: 'ask',
        workingDirectory: root,
      });
      expect(result).not.toBeNull();
      expect(result!.updatedToolOutput).toBeDefined();
      expect(result!.updatedToolOutput).toContain('[REDACTED:OPENAI_KEY]');
      expect(result!.updatedToolOutput).not.toContain(OPENAI_KEY);
    });
  });

  it('handles structured Bash { stdout } results', () => {
    withWorkspace((root) => {
      const result = buildToolOutputRedaction({
        toolName: 'Bash',
        toolInput: { command: 'cat config' },
        toolResponse: { stdout: `token=${OPENAI_KEY}`, stderr: '' },
        sessionId: 's1',
        permissionMode: 'ask',
        workingDirectory: root,
      });
      expect(result?.updatedToolOutput).toContain('[REDACTED:OPENAI_KEY]');
      expect(result?.updatedToolOutput).not.toContain(OPENAI_KEY);
    });
  });

  it('blocks built-in output containing a private key (default policy)', () => {
    withWorkspace((root) => {
      const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----';
      const result = buildToolOutputRedaction({
        toolName: 'Read',
        toolInput: { file_path: 'key.txt' },
        toolResponse: pem,
        sessionId: 's1',
        permissionMode: 'ask',
        workingDirectory: root,
      });
      expect(result?.updatedToolOutput).toBeDefined();
      expect(result!.updatedToolOutput).not.toContain('MIIEpAIBAAKCAQEA');
    });
  });

  it('leaves clean output untouched (no redaction, no notice)', () => {
    withWorkspace((root) => {
      const result = buildToolOutputRedaction({
        toolName: 'Bash',
        toolInput: { command: 'echo hi' },
        toolResponse: 'just normal output, nothing sensitive',
        sessionId: 's1',
        permissionMode: 'ask',
        workingDirectory: root,
      });
      expect(result).toBeNull();
    });
  });

  it('skips mcp__ tools (guarded upstream)', () => {
    const result = buildToolOutputRedaction({
      toolName: 'mcp__linear__createIssue',
      toolInput: {},
      toolResponse: `key=${OPENAI_KEY}`,
      sessionId: 's1',
      permissionMode: 'ask',
      workingDirectory: '/tmp',
    });
    expect(result).toBeNull();
  });

  it('no-ops when protection is disabled', () => {
    const result = buildToolOutputRedaction({
      toolName: 'Bash',
      toolInput: { command: 'printenv' },
      toolResponse: `OPENAI_API_KEY=${OPENAI_KEY}`,
      sessionId: 's1',
      permissionMode: 'ask',
      workingDirectory: '/tmp',
      config: { enabled: false },
    });
    expect(result).toBeNull();
  });

  it('no-ops for image-only tool results (no extractable text)', () => {
    const result = buildToolOutputRedaction({
      toolName: 'Read',
      toolInput: { file_path: 'photo.png' },
      toolResponse: { content: [{ type: 'image', source: { data: 'AAAABBBBCCCC1234567890' } }] },
      sessionId: 's1',
      permissionMode: 'ask',
      workingDirectory: '/tmp',
    });
    expect(result).toBeNull();
  });

  it('writes an audit entry (metadata only) when audit is enabled and findings exist', () => {
    withWorkspace((root) => {
      const auditFile = join(root, 'audit', 'sensitive-context.jsonl');
      buildToolOutputRedaction({
        toolName: 'Bash',
        toolInput: { command: 'printenv' },
        toolResponse: `OPENAI_API_KEY=${OPENAI_KEY}`,
        sessionId: 'sess-audit',
        permissionMode: 'ask',
        workingDirectory: root,
        audit: { filePath: auditFile, enabled: true },
      });
      expect(existsSync(auditFile)).toBe(true);
      const entry = JSON.parse(readFileSync(auditFile, 'utf8').trim());
      expect(entry.sessionId).toBe('sess-audit');
      expect(entry.toolName).toBe('Bash');
      expect(entry.findings.some((f: { type: string }) => f.type === 'openai_key')).toBe(true);
      expect(entry.rawValueStored).toBe(false);
      // never persists the raw secret value
      expect(readFileSync(auditFile, 'utf8')).not.toContain(OPENAI_KEY);
    });
  });

  it('does not write an audit entry when auditing is disabled', () => {
    withWorkspace((root) => {
      const auditFile = join(root, 'audit', 'sensitive-context.jsonl');
      buildToolOutputRedaction({
        toolName: 'Bash',
        toolInput: { command: 'printenv' },
        toolResponse: `OPENAI_API_KEY=${OPENAI_KEY}`,
        sessionId: 'sess-audit',
        permissionMode: 'ask',
        workingDirectory: root,
        audit: { filePath: auditFile, enabled: false },
      });
      expect(existsSync(auditFile)).toBe(false);
    });
  });

  it('does not write an audit entry for clean output (no findings)', () => {
    withWorkspace((root) => {
      const auditFile = join(root, 'audit', 'sensitive-context.jsonl');
      buildToolOutputRedaction({
        toolName: 'Bash',
        toolInput: { command: 'echo hi' },
        toolResponse: 'nothing sensitive here',
        sessionId: 'sess-audit',
        permissionMode: 'ask',
        workingDirectory: root,
        audit: { filePath: auditFile, enabled: true },
      });
      expect(existsSync(auditFile)).toBe(false);
    });
  });

  it('redacts secrets regardless of permission mode', () => {
    withWorkspace((root) => {
      const result = buildToolOutputRedaction({
        toolName: 'Bash',
        toolInput: { command: 'printenv' },
        toolResponse: `OPENAI_API_KEY=${OPENAI_KEY}`,
        sessionId: 's1',
        permissionMode: 'safe',
        workingDirectory: root,
      });
      expect(result?.updatedToolOutput).toBeDefined();
      expect(result!.updatedToolOutput).not.toContain(OPENAI_KEY);
    });
  });
});

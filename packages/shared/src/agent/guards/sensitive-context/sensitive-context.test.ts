import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addSensitivePathAllowRule,
  formatSensitiveProtectionNotice,
  guardSensitiveToolPath,
  guardToolResult,
  listSensitivePathAllowRules,
  redactSensitiveText,
  scanSensitiveText,
} from './index.ts';
import type { SensitiveMatch } from './types.ts';
import { runPreToolUseChecks, type PermissionManagerLike } from '../../core/pre-tool-use.ts';

const permissionManager: PermissionManagerLike = {
  isCommandWhitelisted: () => false,
  isDangerousCommand: () => false,
  getBaseCommand: command => command.split(/\s+/)[0] ?? command,
  extractDomainFromNetworkCommand: () => null,
  isDomainWhitelisted: () => false,
};

describe('SensitiveScanner', () => {
  it('detects and aggregates high-confidence secrets without storing raw values in findings', () => {
    const result = scanSensitiveText([
      'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456',
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz1234567890',
    ].join('\n'));

    expect(result.findings.map(finding => finding.type).sort()).toEqual(['oauth_token', 'openai_key']);
    expect(JSON.stringify(result.findings)).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz123456');
    expect(JSON.stringify(result.findings)).not.toContain('abcdefghijklmnopqrstuvwxyz1234567890');
  });

  it('classifies Anthropic keys separately from OpenAI keys', () => {
    const result = scanSensitiveText('ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstuvwxyz123456');

    expect(result.findings.map(finding => finding.type)).toEqual(['anthropic_key']);
  });

  it('does not flag PII (out of scope for the credential safety net)', () => {
    const result = scanSensitiveText('Contact jane@example.com or 415-555-0199, card 4111111111111111.');
    expect(result.findings).toHaveLength(0);
  });

  describe('redactSensitiveText overlap handling', () => {
    const m = (start: number, end: number, replacement: string): SensitiveMatch => ({
      type: 'unknown_secret', severity: 'high', confidence: 'high', line: 1, start, end, replacement,
    });

    it('covers the tail of a partially-overlapping match (no raw leak)', () => {
      const text = 'AAAAAAAAAABBBBBBBBBB'; // [0,10)=A, [10,20)=B
      // match1 covers [0,12), match2 overlaps at [8,20). The tail [12,20) must not leak.
      const out = redactSensitiveText(text, [m(0, 12, '[R1]'), m(8, 20, '[R2]')]);
      expect(out).not.toContain('A');
      expect(out).not.toContain('B');
      expect(out).toBe('[R1][R2]');
    });

    it('skips a match fully contained in an earlier one', () => {
      const text = '0123456789';
      const out = redactSensitiveText(text, [m(0, 10, '[ALL]'), m(3, 6, '[INNER]')]);
      expect(out).toBe('[ALL]');
    });
  });
});

describe('ToolResultGuard', () => {
  it('redacts secrets in tool output', () => {
    const decision = guardToolResult({
      sessionId: 'session-1',
      toolName: 'Bash',
      toolInput: { command: 'env' },
      resultText: 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456',
      permissionMode: 'ask',
    });

    expect(decision.action).toBe('redact');
    if (decision.action === 'redact') {
      expect(decision.text).toContain('OPENAI_API_KEY=[REDACTED:OPENAI_KEY]');
      expect(decision.text).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz123456');
    }
  });

  it('formats a model-visible redaction notice without raw sensitive values', () => {
    const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';
    const decision = guardToolResult({
      sessionId: 'session-1',
      toolName: 'Bash',
      toolInput: { command: 'env' },
      resultText: `OPENAI_API_KEY=${secret}`,
      permissionMode: 'ask',
    });

    expect(decision.action).toBe('redact');
    if (decision.action === 'redact') {
      const notice = formatSensitiveProtectionNotice(decision);
      expect(notice).toContain('Sensitive data redacted');
      expect(notice).toContain('openai_key x1');
      expect(notice).toContain('Raw values were not stored');
      expect(notice).not.toContain(secret);
    }
  });

  it('blocks private keys before returning text to the model', () => {
    const decision = guardToolResult({
      sessionId: 'session-1',
      toolName: 'Read',
      toolInput: { file_path: 'id_rsa' },
      resultText: [
        '-----BEGIN PRIVATE KEY-----',
        'abc123',
        '-----END PRIVATE KEY-----',
      ].join('\n'),
      permissionMode: 'ask',
    });

    expect(decision.action).toBe('block');
    expect('text' in decision).toBe(false);
  });

  it('does not redact PII (email/phone) — out of scope', () => {
    const decision = guardToolResult({
      sessionId: 'session-1',
      toolName: 'Read',
      toolInput: { file_path: 'README.md' },
      resultText: 'Contact jane@example.com or 415-555-0199 for details.',
      permissionMode: 'ask',
    });

    expect(decision.action).toBe('allow');
    if (decision.action === 'allow') {
      expect(decision.text).toContain('jane@example.com');
    }
  });

  it('allows secrets when secret coverage is disabled', () => {
    const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';
    const decision = guardToolResult({
      sessionId: 'session-1',
      toolName: 'Bash',
      toolInput: { command: 'env' },
      resultText: `OPENAI_API_KEY=${secret}`,
      permissionMode: 'ask',
      config: {
        secrets: { enabled: false, action: 'redact' },
      },
    });

    expect(decision.action).toBe('allow');
    if (decision.action === 'allow') {
      expect(decision.text).toContain(secret);
    }
  });

  it('allows private keys when private key coverage is disabled', () => {
    const privateKey = [
      '-----BEGIN PRIVATE KEY-----',
      'abc123',
      '-----END PRIVATE KEY-----',
    ].join('\n');
    const decision = guardToolResult({
      sessionId: 'session-1',
      toolName: 'Read',
      toolInput: { file_path: 'id_rsa' },
      resultText: privateKey,
      permissionMode: 'ask',
      config: {
        privateKeys: { enabled: false, action: 'block' },
      },
    });

    expect(decision.action).toBe('allow');
    if (decision.action === 'allow') {
      expect(decision.text).toContain(privateKey);
    }
  });

  it('allows output when output redaction is disabled', () => {
    const secret = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';
    const decision = guardToolResult({
      sessionId: 'session-1',
      toolName: 'Bash',
      toolInput: { command: 'env' },
      resultText: `OPENAI_API_KEY=${secret}`,
      permissionMode: 'ask',
      config: { outputRedaction: { enabled: false } },
    });

    expect(decision.action).toBe('allow');
  });
});

describe('SensitivePathGuard', () => {
  it('blocks direct reads of credential files', () => {
    const result = guardSensitiveToolPath('Read', { file_path: '.env.local' }, '/repo');

    expect(result.action).toBe('block');
    expect(result.rule).toBe('.env');
    expect(result.reason).toContain('Sensitive path blocked');
  });

  it('blocks Bash commands that target credential files', () => {
    const result = guardSensitiveToolPath('Bash', { command: 'cat .env.local' }, '/repo');

    expect(result.action).toBe('block');
    expect(result.rule).toBe('.env');
  });

  it('includes anti-bypass guidance in the block reason', () => {
    const result = guardSensitiveToolPath('Read', { file_path: '~/.ssh/id_rsa' }, '/repo');
    expect(result.action).toBe('block');
    expect(result.reason).toContain('Do not attempt to bypass');
    expect(result.reason).toContain('ask them to provide it manually');
  });

  it('blocks credential-file access via Grep / Glob / Edit / Write, not just Read', () => {
    for (const toolName of ['Grep', 'Glob', 'Edit', 'Write', 'MultiEdit'] as const) {
      const result = guardSensitiveToolPath(toolName, { path: '~/.ssh/id_rsa', file_path: '~/.ssh/id_rsa' }, '/repo');
      expect(result.action).toBe('block');
    }
    // Grep targeting a .pem via its `path` argument is blocked
    expect(guardSensitiveToolPath('Grep', { path: 'certs/server.pem' }, '/repo').action).toBe('block');
    // NotebookEdit on an .env is blocked
    expect(guardSensitiveToolPath('NotebookEdit', { notebook_path: '.env.local' }, '/repo').action).toBe('block');
  });

  it('blocks Grep/Glob that target credential files via a glob/pattern selector', () => {
    // Grep restricted to .env files while `path` stays innocuous
    expect(guardSensitiveToolPath('Grep', { path: '/repo', glob: '.env*', pattern: '.*' }, '/repo').action).toBe('block');
    expect(guardSensitiveToolPath('Grep', { path: '/repo', glob: '**/*.pem' }, '/repo').action).toBe('block');
    // Glob whose pattern targets private keys
    expect(guardSensitiveToolPath('Glob', { path: '/repo', pattern: '**/id_rsa' }, '/repo').action).toBe('block');
    // Grep `pattern` (content regex) must NOT be treated as a file selector
    expect(guardSensitiveToolPath('Grep', { path: '/repo/src', pattern: 'id_rsa' }, '/repo').action).toBe('allow');
    // A broad glob does not over-block
    expect(guardSensitiveToolPath('Grep', { path: '/repo', glob: '*.ts' }, '/repo').action).toBe('allow');
  });

  describe('interpreter-embedded path bypass (best-effort)', () => {
    const block = (command: string) => guardSensitiveToolPath('Bash', { command }, '/repo');

    it('blocks a .ssh path assembled inside python -c', () => {
      const r = block(`python3 -c "import os; open(os.path.join(os.environ['HOME'], '.ssh', 'config'))"`);
      expect(r.action).toBe('block');
      expect(r.rule).toBe('.ssh/**');
    });

    it('blocks id_rsa / .pem accessed via node -e', () => {
      expect(block(`node -e "require('fs').readFileSync(process.env.HOME + '/x/a.pem')"`).action).toBe('block');
      expect(block(`ruby -e 'File.read("#{ENV[%q(HOME)]}/x/id_rsa")'`).action).toBe('block');
    });

    it('blocks a path assembled from shell variables inside bash -c', () => {
      expect(block(`bash -c 'p=.ssh; cat ~/$p/config'`).action).toBe('block');
    });

    it('does NOT flag os.environ / process.env (interpreter false positives)', () => {
      expect(block(`python3 -c "import os; print(os.environ['HOME'])"`).action).toBe('allow');
      expect(block(`node -e "console.log(process.env.NODE_ENV)"`).action).toBe('allow');
      expect(block(`python3 -c "print({}.keys())"`).action).toBe('allow');
    });

    it('does not engage without an inline interpreter (plain text mentioning .ssh)', () => {
      expect(block(`echo "remember to check your .ssh folder"`).action).toBe('allow');
    });
  });

  it('blocks credential paths after PreToolUse path expansion', () => {
    const result = runPreToolUseChecks({
      toolName: 'Read',
      input: { file_path: '.aws/credentials' },
      sessionId: 'sensitive-path-test',
      permissionMode: 'ask',
      workspaceRootPath: '/repo',
      workspaceId: 'repo',
      workingDirectory: '/repo',
      activeSourceSlugs: [],
      allSourceSlugs: [],
      hasSourceActivation: false,
      permissionManager,
    });

    expect(result.type).toBe('block');
    if (result.type === 'block') {
      expect(result.reason).toContain('Matched sensitive credential file rule: .aws/credentials');
      expect(result.reason).not.toContain('AKIA');
    }
  });

  it('blocks private key paths even when sensitive files are configured to prompt', () => {
    const result = runPreToolUseChecks({
      toolName: 'Read',
      input: { file_path: '~/.ssh/id_rsa' },
      sessionId: 'private-key-block-test',
      permissionMode: 'ask',
      workspaceRootPath: '/repo',
      workspaceId: 'repo',
      workingDirectory: '/repo',
      activeSourceSlugs: [],
      allSourceSlugs: [],
      hasSourceActivation: false,
      permissionManager,
      sensitiveContextProtection: {
        enabled: true,
        sensitiveFiles: { enabled: true, action: 'prompt' },
      },
    });

    expect(result.type).toBe('block');
    if (result.type === 'block') {
      expect(result.reason).toContain('Matched sensitive credential file rule: id_rsa');
    }
  });

  it('allows a prompted credential path after the same path is approved for the session', () => {
    const whitelisted = new Set(['/repo/.env']);
    const sessionPermissionManager: PermissionManagerLike = {
      ...permissionManager,
      isCommandWhitelisted: command => whitelisted.has(command),
    };

    const result = runPreToolUseChecks({
      toolName: 'Read',
      input: { file_path: '.env' },
      sessionId: 'sensitive-path-session-allow-test',
      permissionMode: 'ask',
      workspaceRootPath: '/repo',
      workspaceId: 'repo',
      workingDirectory: '/repo',
      activeSourceSlugs: [],
      allSourceSlugs: [],
      hasSourceActivation: false,
      permissionManager: sessionPermissionManager,
      sensitiveContextProtection: {
        enabled: true,
        sensitiveFiles: { enabled: true, action: 'prompt' },
      },
    });

    expect(result.type).toBe('allow');
  });

  it('allows a prompted credential path after a workspace redaction allow rule is saved', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'scp-redaction-rules-'));
    try {
      mkdirSync(join(workspaceRoot, '.zo'), { recursive: true });
      writeFileSync(join(workspaceRoot, '.zo', 'config.json'), '{}\n', 'utf-8');
      addSensitivePathAllowRule(workspaceRoot, join(workspaceRoot, '.env'), 'permission_prompt');

      const result = runPreToolUseChecks({
        toolName: 'Read',
        input: { file_path: '.env' },
        sessionId: 'sensitive-path-permanent-allow-test',
        permissionMode: 'ask',
        workspaceRootPath: workspaceRoot,
        workspaceId: 'repo',
        workingDirectory: workspaceRoot,
        activeSourceSlugs: [],
        allSourceSlugs: [],
        hasSourceActivation: false,
        permissionManager,
        sensitiveContextProtection: {
          enabled: true,
          sensitiveFiles: { enabled: true, action: 'prompt' },
        },
      });

      expect(result.type).toBe('allow');
      expect(listSensitivePathAllowRules(workspaceRoot).map(rule => rule.path)).toContain(join(workspaceRoot, '.env'));
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('allows credential paths when credential file protection is disabled', () => {
    const result = runPreToolUseChecks({
      toolName: 'Read',
      input: { file_path: '.env' },
      sessionId: 'sensitive-path-disabled-test',
      permissionMode: 'ask',
      workspaceRootPath: '/repo',
      workspaceId: 'repo',
      workingDirectory: '/repo',
      activeSourceSlugs: [],
      allSourceSlugs: [],
      hasSourceActivation: false,
      permissionManager,
      sensitiveContextProtection: {
        enabled: true,
        credentialFiles: { enabled: false, action: 'block' },
      },
    });

    expect(result.type).toBe('allow');
  });
});

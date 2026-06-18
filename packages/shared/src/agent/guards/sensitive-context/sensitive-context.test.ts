import { describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addFieldRedactionRule,
  addSensitivePathAllowRule,
  addSourceFieldRedactionRule,
  formatSensitiveProtectionNotice,
  formatFieldRuleSuggestionNotice,
  guardSensitiveToolPath,
  guardToolResult,
  listFieldRedactionRules,
  listSensitivePathAllowRules,
  scanSensitiveText,
} from './index.ts';
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
});

describe('ToolResultGuard', () => {
  it('redacts secrets in balanced mode', () => {
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

  it('redacts PII by default for personal protection', () => {
    const decision = guardToolResult({
      sessionId: 'session-1',
      toolName: 'Read',
      toolInput: { file_path: 'README.md' },
      resultText: 'Contact jane@example.com for details.',
      permissionMode: 'ask',
    });

    expect(decision.action).toBe('redact');
    expect(decision.findings).toHaveLength(1);
    expect(decision.findings[0]?.type).toBe('email');
    if (decision.action === 'redact') {
      expect(decision.text).toBe('Contact [REDACTED:EMAIL] for details.');
    }
  });

  it('redacts structured JSON fields by sensitive field name', () => {
    const decision = guardToolResult({
      sessionId: 'session-1',
      toolName: 'mcp__crm__getContacts',
      toolInput: {},
      resultText: JSON.stringify({
        customer: 'Jane',
        email: 'jane@example.com',
        mobile_phone: '19384007303',
        notes: 'keep this',
      }),
      permissionMode: 'ask',
    });

    expect(decision.action).toBe('redact');
    if (decision.action === 'redact') {
      expect(decision.text).toContain('[REDACTED:EMAIL]');
      expect(decision.text).toContain('[REDACTED:PHONE]');
      expect(decision.text).toContain('keep this');
      expect(decision.text).not.toContain('jane@example.com');
      expect(decision.text).not.toContain('19384007303');
    }
  });

  it('redacts structured CSV columns by sensitive header name', () => {
    const decision = guardToolResult({
      sessionId: 'session-1',
      toolName: 'Bash',
      toolInput: { command: 'cat customers.csv' },
      resultText: [
        'name,email,phone,city',
        'Jane,jane@example.com,19384007303,Shanghai',
        'John,john@example.com,18328076061,Beijing',
      ].join('\n'),
      permissionMode: 'ask',
    });

    expect(decision.action).toBe('redact');
    if (decision.action === 'redact') {
      expect(decision.text).toContain('name,email,phone,city');
      expect(decision.text).toContain('Jane,[REDACTED:EMAIL],[REDACTED:PHONE],Shanghai');
      expect(decision.text).not.toContain('jane@example.com');
      expect(decision.text).not.toContain('18328076061');
    }
  });

  it('applies conversation-created workspace field redaction rules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sensitive-context-rules-'));
    try {
      addFieldRedactionRule(dir, {
        scope: 'workspace',
        fields: ['salary'],
        action: 'redact',
        note: 'User asked to hide salary fields in this workspace.',
      });

      expect(listFieldRedactionRules(dir)).toHaveLength(1);

      const decision = guardToolResult({
        sessionId: 'session-1',
        toolName: 'mcp__crm__getContacts',
        toolInput: {},
        resultText: JSON.stringify({ name: 'Jane', salary: 123000, city: 'Shanghai' }),
        permissionMode: 'ask',
        workingDirectory: dir,
        config: {
          outputRedaction: { enabled: false },
          fieldRedaction: { enabled: true },
        },
      });

      expect(decision.action).toBe('redact');
      if (decision.action === 'redact') {
        expect(decision.text).toContain('"salary": "[REDACTED:FIELD]"');
        expect(decision.text).toContain('"city": "Shanghai"');
        expect(decision.text).not.toContain('123000');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('suggests conversation-created rules for suspicious structured fields without storing raw values', () => {
    const decision = guardToolResult({
      sessionId: 'session-1',
      toolName: 'Read',
      toolInput: { file_path: 'clients.csv' },
      resultText: [
        'name,salary,city',
        'Jane,123000,Shanghai',
      ].join('\n'),
      permissionMode: 'ask',
      config: {
        outputRedaction: { enabled: false },
        fieldRedaction: { enabled: true },
      },
    });

    expect(decision.action).toBe('redact');
    expect(decision.suggestions).toEqual([{ field: 'salary', reason: 'compensation field' }]);
    if (decision.action === 'redact') {
      const notice = formatFieldRuleSuggestionNotice(decision.suggestions);
      expect(notice).toContain('Sensitive field rule suggestion');
      expect(notice).toContain('salary (compensation field)');
      expect(notice).not.toContain('123000');
      expect(decision.text).toContain('Jane,[REDACTED:FIELD],Shanghai');
      expect(decision.text).not.toContain('123000');
    }
  });

  it('does not suggest a field rule when a keep rule already exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sensitive-context-keep-rule-'));
    try {
      addFieldRedactionRule(dir, {
        scope: 'workspace',
        fields: ['salary'],
        action: 'keep',
        note: 'User said salary is safe to use for this workspace.',
      });

      const decision = guardToolResult({
        sessionId: 'session-1',
        toolName: 'Read',
        toolInput: { file_path: 'clients.csv' },
        resultText: [
          'name,salary,city',
          'Jane,123000,Shanghai',
        ].join('\n'),
        permissionMode: 'ask',
        workingDirectory: dir,
        config: {
          outputRedaction: { enabled: false },
          fieldRedaction: { enabled: true },
        },
      });

      expect(decision.action).toBe('allow');
      expect(decision.suggestions).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('suggests source-local field rules for source result fields', () => {
    const decision = guardToolResult({
      sessionId: 'session-1',
      toolName: 'mcp__crm__getAccounts',
      toolInput: {},
      resultText: JSON.stringify({ name: 'Acme', address: '1 Main St', city: 'Shanghai' }),
      permissionMode: 'ask',
      sourceSlug: 'crm',
      config: {
        outputRedaction: { enabled: false },
        fieldRedaction: { enabled: true },
      },
    });

    expect(decision.action).toBe('redact');
    expect(decision.suggestions).toEqual([{ field: 'address', reason: 'address field' }]);
    if (decision.action === 'redact') {
      expect(decision.text).toContain('"address": "[REDACTED:FIELD]"');
      expect(decision.text).not.toContain('1 Main St');
    }
  });

  it('applies file-scoped field drop rules from redaction.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sensitive-context-file-rules-'));
    try {
      addFieldRedactionRule(dir, {
        scope: 'file',
        match: 'clients_*.csv',
        fields: ['salary'],
        action: 'drop',
        note: 'User asked to remove salary from client exports.',
      });

      const decision = guardToolResult({
        sessionId: 'session-1',
        toolName: 'Read',
        toolInput: { file_path: 'clients_june.csv' },
        resultText: [
          'name,salary,city',
          'Jane,123000,Shanghai',
          'John,98000,Beijing',
        ].join('\n'),
        permissionMode: 'ask',
        workingDirectory: dir,
        config: {
          outputRedaction: { enabled: false },
          fieldRedaction: { enabled: true },
        },
      });

      expect(decision.action).toBe('redact');
      if (decision.action === 'redact') {
        expect(decision.text).toBe([
          'name,city',
          'Jane,Shanghai',
          'John,Beijing',
        ].join('\n'));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies source-scoped field redaction rules from redaction.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sensitive-context-source-rules-'));
    try {
      addFieldRedactionRule(dir, {
        scope: 'source',
        match: 'crm',
        fields: ['account_tier'],
        action: 'redact',
        note: 'User asked to hide account tier for CRM source results.',
      });

      const decision = guardToolResult({
        sessionId: 'session-1',
        toolName: 'mcp__crm__getAccounts',
        toolInput: {},
        resultText: JSON.stringify({ name: 'Acme', account_tier: 'enterprise', city: 'Shanghai' }),
        permissionMode: 'ask',
        sourceSlug: 'crm',
        workingDirectory: dir,
        config: {
          outputRedaction: { enabled: false },
          fieldRedaction: { enabled: true },
        },
      });

      expect(decision.action).toBe('redact');
      if (decision.action === 'redact') {
        expect(decision.text).toContain('"account_tier": "[REDACTED:FIELD]"');
        expect(decision.text).not.toContain('enterprise');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies source-local redaction.json field rules', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sensitive-context-source-local-rules-'));
    try {
      addSourceFieldRedactionRule(dir, 'crm', {
        fields: ['internal_notes'],
        action: 'drop',
        note: 'User asked to drop CRM internal notes.',
      });

      const decision = guardToolResult({
        sessionId: 'session-1',
        toolName: 'mcp__crm__getAccounts',
        toolInput: {},
        resultText: JSON.stringify({ name: 'Acme', internal_notes: 'renewal risk', city: 'Shanghai' }),
        permissionMode: 'ask',
        sourceSlug: 'crm',
        workingDirectory: dir,
        config: {
          outputRedaction: { enabled: false },
          fieldRedaction: { enabled: true },
        },
      });

      expect(decision.action).toBe('redact');
      if (decision.action === 'redact') {
        expect(decision.text).toContain('"name": "Acme"');
        expect(decision.text).not.toContain('internal_notes');
        expect(decision.text).not.toContain('renewal risk');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('redacts segmented Chinese mobile numbers when PII protection is enabled', () => {
    const decision = guardToolResult({
      sessionId: 'session-1',
      toolName: 'Bash',
      toolInput: { command: 'python3 split_phone.py' },
      resultText: [
        'chunked=193 840 073 03',
        'chars=1 9 3 8 4 0 0 7 3 0 3',
      ].join('\n'),
      permissionMode: 'ask',
      config: {
        pii: { enabled: true, action: 'redact' },
      },
    });

    expect(decision.action).toBe('redact');
    if (decision.action === 'redact') {
      expect(decision.text).toContain('chunked=[REDACTED:PHONE]');
      expect(decision.text).toContain('chars=[REDACTED:PHONE]');
      expect(decision.text).not.toContain('193 840 073 03');
      expect(decision.text).not.toContain('1 9 3 8 4 0 0 7 3 0 3');
    }
  });

  it('redacts xxd-style hex dump lines that encode Chinese mobile numbers', () => {
    const decision = guardToolResult({
      sessionId: 'session-1',
      toolName: 'Bash',
      toolInput: { command: 'xxd phone_test_data.csv | head' },
      resultText: [
        '000000b0: e9ab 98e7 a38a 2c31 3833 3238 3037 3630  ......,183280760',
        '000000c0: 3631 2c2c 2ce6 b7b1 e59c b32c 7573 6572  61,,,......,user',
      ].join('\n'),
      permissionMode: 'ask',
      config: {
        pii: { enabled: true, action: 'redact' },
      },
    });

    expect(decision.action).toBe('redact');
    if (decision.action === 'redact') {
      expect(decision.text).toContain('[REDACTED:PHONE]');
      expect(decision.text).not.toContain('183280760');
      expect(decision.text).not.toContain('3631');
    }
  });

  it('redacts od-style hex dump lines that encode Chinese mobile numbers', () => {
    const decision = guardToolResult({
      sessionId: 'session-1',
      toolName: 'Bash',
      toolInput: { command: 'od -Ax -tx1 phone_test_data.csv | head' },
      resultText: '0000260 31 38 33 32 38 30 37 36 30 36 31 2c 2c 2c',
      permissionMode: 'ask',
      config: {
        pii: { enabled: true, action: 'redact' },
      },
    });

    expect(decision.action).toBe('redact');
    if (decision.action === 'redact') {
      expect(decision.text).toContain('[REDACTED:PHONE]');
      expect(decision.text).not.toContain('31 38 33 32 38 30 37 36 30 36 31');
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

  it('returns the effective policy mode used for decisions', () => {
    const decision = guardToolResult({
      sessionId: 'session-1',
      toolName: 'Bash',
      toolInput: { command: 'env' },
      resultText: 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456',
      permissionMode: 'ask',
      config: {
        mode: 'strict',
      },
    });

    expect(decision.policyMode).toBe('strict');
    expect(decision.action).toBe('block');
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

import { describe, it, expect } from 'bun:test';
import { normalizeSensitiveContextProtectionSettings } from '../storage.ts';

describe('normalizeSensitiveContextProtectionSettings (validation)', () => {
  it('rejects invalid enum values and falls back to defaults', () => {
    const result = normalizeSensitiveContextProtectionSettings({
      // @ts-expect-error — exercising untrusted input
      secrets: { enabled: true, action: 'definitely-not-an-action' },
      // @ts-expect-error
      sensitiveFiles: { enabled: true, action: 'redact' }, // 'redact' is not a valid file action
    });
    expect(result.secrets.action).toBe('redact'); // default
    expect(result.sensitiveFiles.action).toBe('prompt'); // default file action
  });

  it('drops unknown top-level keys instead of persisting them', () => {
    // Untrusted payload (e.g. hand-edited config.json) with stray keys.
    const untrusted = { __proto_pollution: { evil: true }, arbitrary: 'value', enabled: true } as unknown as Parameters<typeof normalizeSensitiveContextProtectionSettings>[0];
    const result = normalizeSensitiveContextProtectionSettings(untrusted);
    expect('__proto_pollution' in result).toBe(false);
    expect('arbitrary' in result).toBe(false);
    expect(result.enabled).toBe(true);
  });

  it('always forces audit.storeRawValues false', () => {
    const result = normalizeSensitiveContextProtectionSettings({
      // @ts-expect-error — storeRawValues is a literal false; reject attempts to flip it
      audit: { enabled: true, storeRawValues: true },
    });
    expect(result.audit.storeRawValues).toBe(false);
  });

  it('disabling output redaction disables secret/private-key redaction', () => {
    const result = normalizeSensitiveContextProtectionSettings({
      outputRedaction: { enabled: false },
    });
    expect(result.secrets.enabled).toBe(false);
    expect(result.privateKeys.enabled).toBe(false);
  });

  it('mirrors sensitiveFiles into the legacy credentialFiles alias', () => {
    const result = normalizeSensitiveContextProtectionSettings({
      sensitiveFiles: { enabled: true, action: 'block' },
    });
    expect(result.credentialFiles.enabled).toBe(true);
    expect(result.credentialFiles.action).toBe('block');
  });
});

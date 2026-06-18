import { describe, expect, it } from 'bun:test';
import { resolvePermissionResponse } from '../permission-response.ts';

describe('resolvePermissionResponse', () => {
  it('allows normal permission responses to use sanitized input when available', () => {
    expect(resolvePermissionResponse(true)).toEqual({
      allowed: true,
      useModifiedInput: true,
    });
  });

  it('sends raw input when sensitive egress is explicitly approved as-is', () => {
    expect(resolvePermissionResponse(true, { egressAction: 'send' })).toEqual({
      allowed: true,
      useModifiedInput: false,
    });
  });

  it('sends modified input when sensitive egress is approved with redaction', () => {
    expect(resolvePermissionResponse(true, { egressAction: 'send_redacted' })).toEqual({
      allowed: true,
      useModifiedInput: true,
    });
  });

  it('denies execution when sensitive egress is canceled', () => {
    expect(resolvePermissionResponse(true, { egressAction: 'cancel' })).toEqual({
      allowed: false,
      useModifiedInput: true,
    });
  });

  it('keeps explicit denial denied regardless of requested egress action', () => {
    expect(resolvePermissionResponse(false, { egressAction: 'send' })).toEqual({
      allowed: false,
      useModifiedInput: false,
    });
  });
});

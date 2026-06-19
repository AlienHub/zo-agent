import { describe, expect, it } from 'bun:test';
import { resolvePermissionResponse } from '../permission-response.ts';

describe('resolvePermissionResponse', () => {
  it('uses modified input when an approval is granted', () => {
    expect(resolvePermissionResponse(true)).toEqual({
      allowed: true,
      useModifiedInput: true,
    });
  });

  it('keeps a denial denied', () => {
    expect(resolvePermissionResponse(false)).toEqual({
      allowed: false,
      useModifiedInput: true,
    });
  });

  it('ignores unrelated permission options', () => {
    expect(resolvePermissionResponse(true, { permissionScope: 'session' })).toEqual({
      allowed: true,
      useModifiedInput: true,
    });
  });
});

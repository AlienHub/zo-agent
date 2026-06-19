import type { PermissionResponseOptions } from '../../protocol/dto.ts';

export interface PermissionResolution {
  allowed: boolean;
  useModifiedInput: boolean;
}

export function resolvePermissionResponse(
  allowed: boolean,
  _options?: PermissionResponseOptions,
): PermissionResolution {
  // Modified input (path expansion, RTK rewrite, admin-wrap) is always applied when present.
  return { allowed, useModifiedInput: true };
}

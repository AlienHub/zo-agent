import type { PermissionResponseOptions } from '../../protocol/dto.ts';

export interface PermissionResolution {
  allowed: boolean;
  useModifiedInput: boolean;
}

export function resolvePermissionResponse(
  allowed: boolean,
  options?: PermissionResponseOptions,
): PermissionResolution {
  return {
    allowed: allowed && options?.egressAction !== 'cancel',
    useModifiedInput: options?.egressAction !== 'send',
  };
}

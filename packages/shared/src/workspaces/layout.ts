import { existsSync } from 'fs';
import { join } from 'path';

export const WORKSPACE_DATA_DIR = '.zo';

export function getPreferredWorkspaceDataPath(rootPath: string): string {
  return join(rootPath, WORKSPACE_DATA_DIR);
}

export function getLegacyWorkspaceDataPath(rootPath: string): string {
  return rootPath;
}

export function getWorkspaceDataPath(rootPath: string): string {
  const preferred = getPreferredWorkspaceDataPath(rootPath);
  if (existsSync(join(preferred, 'config.json'))) {
    return preferred;
  }

  const legacy = getLegacyWorkspaceDataPath(rootPath);
  if (existsSync(join(legacy, 'config.json'))) {
    return legacy;
  }

  return preferred;
}

export function getWorkspaceConfigPath(rootPath: string): string {
  return join(getWorkspaceDataPath(rootPath), 'config.json');
}

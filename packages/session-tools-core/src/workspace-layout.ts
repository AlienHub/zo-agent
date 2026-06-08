import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const WORKSPACE_DATA_DIR = '.zo';

export function getWorkspaceDataPath(workspaceRootPath: string): string {
  const preferred = join(workspaceRootPath, WORKSPACE_DATA_DIR);
  if (existsSync(join(preferred, 'config.json'))) {
    return preferred;
  }

  if (existsSync(join(workspaceRootPath, 'config.json'))) {
    return workspaceRootPath;
  }

  // Tests and older partial workspaces may create a specific legacy file tree
  // without a workspace config. Keep those readable while new writes still
  // default to .zo when no legacy state exists.
  const legacyMarkers = [
    'sources',
    'sessions',
    'skills',
    'statuses',
    'labels',
    'permissions.json',
    'automations.json',
  ];
  if (legacyMarkers.some((marker) => existsSync(join(workspaceRootPath, marker)))) {
    return workspaceRootPath;
  }

  return preferred;
}

export function getWorkspaceSourcesPath(workspaceRootPath: string): string {
  return join(getWorkspaceDataPath(workspaceRootPath), 'sources');
}

export function getWorkspaceSessionsPath(workspaceRootPath: string): string {
  return join(getWorkspaceDataPath(workspaceRootPath), 'sessions');
}

export function getWorkspaceSkillsPath(workspaceRootPath: string): string {
  return join(getWorkspaceDataPath(workspaceRootPath), 'skills');
}

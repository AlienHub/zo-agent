import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createWorkspaceAtPath,
  getWorkspaceSessionsPath,
  getWorkspaceSkillsPath,
  getWorkspaceSourcesPath,
  isValidWorkspace,
  loadWorkspaceConfig,
} from '../storage.ts';
import { getWorkspaceConfigPath, getWorkspaceDataPath } from '../layout.ts';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors in tests
    }
  }
});

describe('workspace storage: config normalization', () => {
  it('sets the workspace folder as the default working directory for new workspaces', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'ws-default-workdir-'));
    tempDirs.push(workspaceRoot);

    const config = createWorkspaceAtPath(workspaceRoot, 'Default Workdir');

    expect(config.defaults?.workingDirectory).toBe(workspaceRoot);
    const loaded = loadWorkspaceConfig(workspaceRoot);
    expect(loaded?.defaults?.workingDirectory).toBe(workspaceRoot);
  });

  it('stores new workspace-owned files under .zo instead of the workspace root', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'ws-dot-zo-'));
    tempDirs.push(workspaceRoot);

    createWorkspaceAtPath(workspaceRoot, 'Dot Zo');

    const rootEntries = readdirSync(workspaceRoot).sort();
    expect(rootEntries).toEqual(['.zo']);
    expect(getWorkspaceDataPath(workspaceRoot)).toBe(join(workspaceRoot, '.zo'));
    expect(getWorkspaceConfigPath(workspaceRoot)).toBe(join(workspaceRoot, '.zo', 'config.json'));
    expect(existsSync(join(workspaceRoot, 'config.json'))).toBe(false);
    expect(existsSync(join(workspaceRoot, '.zo', 'config.json'))).toBe(true);
    expect(getWorkspaceSourcesPath(workspaceRoot)).toBe(join(workspaceRoot, '.zo', 'sources'));
    expect(getWorkspaceSessionsPath(workspaceRoot)).toBe(join(workspaceRoot, '.zo', 'sessions'));
    expect(getWorkspaceSkillsPath(workspaceRoot)).toBe(join(workspaceRoot, '.zo', 'skills'));
    expect(existsSync(join(workspaceRoot, '.zo', 'statuses', 'config.json'))).toBe(true);
    expect(existsSync(join(workspaceRoot, '.zo', 'labels', 'config.json'))).toBe(true);
    expect(existsSync(join(workspaceRoot, '.zo', '.claude-plugin', 'plugin.json'))).toBe(true);
  });

  it('does not treat arbitrary root config.json files as valid workspaces', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'ws-arbitrary-config-'));
    tempDirs.push(workspaceRoot);

    writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify({ scripts: {} }, null, 2), 'utf-8');

    expect(loadWorkspaceConfig(workspaceRoot)).toBeNull();
    expect(isValidWorkspace(workspaceRoot)).toBe(false);
  });

  it('maps canonical defaults.permissionMode and cyclablePermissionModes on read', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'ws-mode-map-'));
    tempDirs.push(workspaceRoot);

    const rawConfig = {
      id: 'ws_123',
      name: 'Test Workspace',
      slug: 'test-workspace',
      defaults: {
        permissionMode: 'explore',
        cyclablePermissionModes: ['explore', 'ask', 'execute'],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify(rawConfig, null, 2), 'utf-8');

    const loaded = loadWorkspaceConfig(workspaceRoot);
    expect(loaded).not.toBeNull();
    expect(loaded?.defaults?.permissionMode).toBe('safe');
    expect(loaded?.defaults?.cyclablePermissionModes).toEqual(['safe', 'ask', 'allow-all']);
  });

  it('falls back to full cycle if persisted cyclablePermissionModes are invalid', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'ws-mode-invalid-'));
    tempDirs.push(workspaceRoot);

    const rawConfig = {
      id: 'ws_456',
      name: 'Broken Modes',
      slug: 'broken-modes',
      defaults: {
        permissionMode: 'execute',
        cyclablePermissionModes: ['unknown'],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify(rawConfig, null, 2), 'utf-8');

    const loaded = loadWorkspaceConfig(workspaceRoot);
    expect(loaded).not.toBeNull();
    expect(loaded?.defaults?.permissionMode).toBe('allow-all');
    expect(loaded?.defaults?.cyclablePermissionModes).toEqual(['safe', 'ask', 'allow-all']);
  });

  it('normalizes legacy defaults.thinkingLevel=think on read', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'ws-thinking-legacy-'));
    tempDirs.push(workspaceRoot);

    const rawConfig = {
      id: 'ws_789',
      name: 'Legacy Thinking',
      slug: 'legacy-thinking',
      defaults: {
        thinkingLevel: 'think',
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify(rawConfig, null, 2), 'utf-8');

    const loaded = loadWorkspaceConfig(workspaceRoot);
    expect(loaded).not.toBeNull();
    expect(loaded?.defaults?.thinkingLevel).toBe('medium');
  });
});

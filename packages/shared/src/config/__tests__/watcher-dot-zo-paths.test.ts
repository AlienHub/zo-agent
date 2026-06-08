import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigWatcher } from '../watcher.ts';
import { createSource, type LoadedSource } from '../../sources/index.ts';
import { createWorkspaceAtPath, getWorkspaceSessionsPath } from '../../workspaces/storage.ts';

const tempDirs: string[] = [];
const watchers: ConfigWatcher[] = [];

afterEach(() => {
  for (const watcher of watchers.splice(0)) {
    watcher.stop();
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function waitForDebounce(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

describe('ConfigWatcher .zo workspace paths', () => {
  it('handles local source config changes reported under .zo/sources', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'watcher-dot-zo-'));
    const localFolder = mkdtempSync(join(tmpdir(), 'watcher-local-source-'));
    tempDirs.push(workspaceRoot, localFolder);

    createWorkspaceAtPath(workspaceRoot, 'Watcher Dot Zo');
    const sourceConfig = await createSource(workspaceRoot, {
      name: 'Local Docs',
      provider: 'local',
      type: 'local',
      local: { path: localFolder, format: 'filesystem' },
    });

    const changedSources: LoadedSource[] = [];
    const watcher = new ConfigWatcher(workspaceRoot, {
      onSourceChange: (_slug, source) => {
        if (source) changedSources.push(source);
      },
    });
    watchers.push(watcher);
    watcher.start();

    watcher.notifyFileChange(`.zo/sources/${sourceConfig.slug}/config.json`);
    await waitForDebounce();

    expect(changedSources.map((source) => source.config.slug)).toContain(sourceConfig.slug);
    expect(changedSources.at(-1)?.config.type).toBe('local');
    expect(changedSources.at(-1)?.config.local?.path).toBe(localFolder);
  });

  it('handles status config and icon changes reported under .zo/statuses', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'watcher-status-dot-zo-'));
    tempDirs.push(workspaceRoot);

    createWorkspaceAtPath(workspaceRoot, 'Watcher Status Dot Zo');

    const statusConfigChanges: string[] = [];
    const statusIconChanges: string[] = [];
    const watcher = new ConfigWatcher(workspaceRoot, {
      onStatusConfigChange: (workspaceId) => {
        statusConfigChanges.push(workspaceId);
      },
      onStatusIconChange: (_workspaceId, iconFilename) => {
        statusIconChanges.push(iconFilename);
      },
    });
    watchers.push(watcher);
    watcher.start();

    watcher.notifyFileChange('.zo/statuses/config.json');
    watcher.notifyFileChange('.zo/statuses/icons/todo.svg');
    await waitForDebounce();

    expect(statusConfigChanges).toHaveLength(1);
    expect(statusIconChanges).toContain('todo.svg');
  });

  it('reads session metadata changes from .zo/sessions', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'watcher-session-dot-zo-'));
    tempDirs.push(workspaceRoot);

    createWorkspaceAtPath(workspaceRoot, 'Watcher Session Dot Zo');

    const sessionId = 'session_123';
    const sessionDir = join(getWorkspaceSessionsPath(workspaceRoot), sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, 'session.jsonl'),
      JSON.stringify({
        id: sessionId,
        workspaceRootPath: workspaceRoot,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        name: 'Session in dot zo',
        isFlagged: false,
        sessionStatus: 'todo',
        labels: [],
      }) + '\n',
      'utf-8',
    );

    const changedSessionIds: string[] = [];
    const watcher = new ConfigWatcher(workspaceRoot, {
      onSessionMetadataChange: (changedSessionId) => {
        changedSessionIds.push(changedSessionId);
      },
    });
    watchers.push(watcher);
    watcher.start();

    watcher.notifyFileChange(`.zo/sessions/${sessionId}/session.jsonl`);
    await waitForDebounce();

    expect(changedSessionIds).toContain(sessionId);
  });
});

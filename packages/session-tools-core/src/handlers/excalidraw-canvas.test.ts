import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import {
  handleExcalidrawCreateCanvas,
  handleExcalidrawDescribeCanvas,
  handleExcalidrawSetGraph,
  resetExcalidrawFailureCountsForTest,
} from './excalidraw-canvas.ts';

function parseResult(result: Awaited<ReturnType<typeof handleExcalidrawCreateCanvas>>) {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, any>;
}

describe('excalidraw canvas tools', () => {
  let rootDir: string;
  let sessionDir: string;
  let updatedPaths: string[];

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'excalidraw-tools-'));
    sessionDir = join(rootDir, 'sessions', 'test-session');
    mkdirSync(sessionDir, { recursive: true });
    updatedPaths = [];
    resetExcalidrawFailureCountsForTest();
  });

  afterEach(() => {
    resetExcalidrawFailureCountsForTest();
    rmSync(rootDir, { recursive: true, force: true });
  });

  function ctx(overrides: Partial<SessionToolContext> = {}): SessionToolContext {
    return {
      sessionId: 'test-session',
      workspacePath: rootDir,
      sourcesPath: join(rootDir, 'sources'),
      skillsPath: join(rootDir, 'skills'),
      plansFolderPath: join(sessionDir, 'plans'),
      callbacks: {
        onPlanSubmitted: () => {},
        onAuthRequest: () => {},
      },
      fs: {
        exists: (path) => existsSync(path),
        readFile: (path) => readFileSync(path, 'utf-8'),
        readFileBuffer: (path) => readFileSync(path),
        writeFile: (path, content) => writeFileSync(path, content, 'utf-8'),
        isDirectory: (path) => existsSync(path),
        readdir: () => [],
        stat: () => ({ size: 0, isDirectory: () => false }),
      },
      loadSourceConfig: () => null,
      sessionPath: sessionDir,
      materializeCanvas: async (graph) => ({
        ok: true,
        previewPng: 'data:image/png;base64,cHJldmlldw==',
        scene: {
          type: 'excalidraw',
          version: 2,
          source: 'craft-agent',
          elements: graph.nodes.map((node, index) => ({ ...node, id: node.id ?? `e${index}` })),
          appState: {},
          files: {},
        },
      }),
      notifyResourceUpdated: (path) => {
        updatedPaths.push(path);
      },
      ...overrides,
    };
  }

  it('creates an empty canvas and stores the graph and excalidraw scene', async () => {
    const result = await handleExcalidrawCreateCanvas(ctx(), { title: 'System flow' });
    const body = parseResult(result);

    expect(result.isError).not.toBe(true);
    expect(body.canvasId).toMatch(/^canvas-/);
    expect(body.path).toEndWith(`${body.canvasId}.excalidraw`);
    expect(existsSync(body.path)).toBe(true);
    expect(existsSync(join(sessionDir, 'canvases', `${body.canvasId}.graph.json`))).toBe(true);
  });

  it('replaces the graph, materializes the scene with a preview, and broadcasts the updated file path', async () => {
    const created = parseResult(await handleExcalidrawCreateCanvas(ctx(), {}));
    const result = await handleExcalidrawSetGraph(ctx(), {
      canvasId: created.canvasId,
      nodes: [
        { id: 'api', label: 'API', group: 'backend' },
        { id: 'db', label: 'DB', group: 'data' },
      ],
      edges: [{ from: 'api', to: 'db', label: 'writes' }],
      direction: 'LR',
    });
    const body = parseResult(result);
    const scene = JSON.parse(readFileSync(created.path, 'utf-8'));
    const graphDoc = JSON.parse(readFileSync(join(sessionDir, 'canvases', `${created.canvasId}.graph.json`), 'utf-8'));

    expect(result.isError).not.toBe(true);
    expect(body.nodeCount).toBe(2);
    expect(body.edgeCount).toBe(1);
    expect(body.previewPngPath).toEndWith(`${created.canvasId}.preview.png`);
    expect(existsSync(body.previewPngPath)).toBe(true);
    expect(scene.type).toBe('excalidraw');
    expect(graphDoc.graph).toEqual({
      nodes: [
        { id: 'api', label: 'API', group: 'backend' },
        { id: 'db', label: 'DB', group: 'data' },
      ],
      edges: [{ from: 'api', to: 'db', label: 'writes' }],
      direction: 'LR',
    });
    expect(updatedPaths).toEqual([created.path]);
  });

  it('describes the stored graph', async () => {
    const created = parseResult(await handleExcalidrawCreateCanvas(ctx(), {}));
    await handleExcalidrawSetGraph(ctx(), {
      canvasId: created.canvasId,
      nodes: [
        { id: 'frontend', label: 'Frontend', group: 'client' },
        { id: 'backend', label: 'Backend', group: 'server' },
      ],
      edges: [{ from: 'frontend', to: 'backend', label: 'calls' }],
      direction: 'TB',
    });

    const result = await handleExcalidrawDescribeCanvas(ctx(), { canvasId: created.canvasId });
    const body = parseResult(result);

    expect(body.graph).toEqual({
      nodes: [
        { id: 'frontend', label: 'Frontend', group: 'client' },
        { id: 'backend', label: 'Backend', group: 'server' },
      ],
      edges: [{ from: 'frontend', to: 'backend', label: 'calls' }],
      direction: 'TB',
    });
  });

  it('terminates after three consecutive materialization failures for the same canvas', async () => {
    const failingCtx = ctx({
      materializeCanvas: async () => ({
        ok: false,
        error: { reason: 'validation_failed', message: 'bad arrow endpoint' },
      }),
    });
    const created = parseResult(await handleExcalidrawCreateCanvas(ctx(), {}));
    const args = {
      canvasId: created.canvasId,
      nodes: [{ id: 'only', label: 'Only node' }],
      edges: [{ from: 'missing-a', to: 'missing-b' }],
    };

    const first = parseResult(await handleExcalidrawSetGraph(failingCtx, args));
    const second = parseResult(await handleExcalidrawSetGraph(failingCtx, args));
    const thirdResult = await handleExcalidrawSetGraph(failingCtx, args);
    const third = parseResult(thirdResult);

    expect(first.terminal).toBe(false);
    expect(second.terminal).toBe(false);
    expect(thirdResult.isError).toBe(true);
    expect(third.terminal).toBe(true);
    expect(third.message).toContain('画布生成失败，请调整需求或稍后再试');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionToolContext } from '../context.ts';
import {
  handleExcalidrawCreateCanvas,
  handleExcalidrawDescribeCanvas,
  handleExcalidrawSetGraph,
  handleExcalidrawSetScene,
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
      materializeScene: async (scene) => ({
        ok: true,
        previewPng: 'data:image/png;base64,c2NlbmU=',
        scene: {
          type: 'excalidraw',
          version: 2,
          source: 'craft-agent',
          elements: [
            ...scene.nodes.map((node) => ({ ...node, id: node.id })),
            ...scene.arrows.map((arrow) => ({ ...arrow, id: arrow.id, type: 'arrow' })),
          ],
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

  it('sets a coordinate scene, stores the scene model, and writes the renderable excalidraw file', async () => {
    const created = parseResult(await handleExcalidrawCreateCanvas(ctx(), { title: 'Visual map' }));
    const result = await handleExcalidrawSetScene(ctx(), {
      canvasId: created.canvasId,
      title: 'Visual map',
      nodes: [
        { id: 'title', type: 'text', x: 40, y: 20, width: 320, height: 40, label: 'Everything you need to know' },
        { id: 'loops', type: 'rectangle', x: 40, y: 90, width: 220, height: 100, label: 'LOOPS', role: 'accent', icon: 'bolt' },
        { id: 'card', type: 'rectangle', x: 320, y: 90, width: 260, height: 100, label: 'Section card' },
      ],
      arrows: [{
        id: 'orange-arrow',
        points: [{ x: 260, y: 140 }, { x: 320, y: 140 }],
        start: 'loops',
        end: 'card',
        role: 'alert',
      }],
    });
    const body = parseResult(result);
    const sceneDoc = JSON.parse(readFileSync(body.sceneModelPath, 'utf-8'));
    const renderDoc = JSON.parse(readFileSync(body.path, 'utf-8'));

    expect(result.isError).not.toBe(true);
    expect(body.path).toEndWith(`${created.canvasId}.excalidraw`);
    expect(body.sceneModelPath).toEndWith(`${created.canvasId}.scene.json`);
    expect(body.nodeCount).toBe(3);
    expect(body.arrowCount).toBe(1);
    expect(sceneDoc.scene.arrows[0].role).toBe('alert');
    expect(renderDoc.type).toBe('excalidraw');
    expect(renderDoc.elements).toHaveLength(4);
    expect(updatedPaths).toEqual([created.path]);
  });

  it('rejects coordinate scenes with invalid arrow references', async () => {
    const created = parseResult(await handleExcalidrawCreateCanvas(ctx(), {}));
    const result = await handleExcalidrawSetScene(ctx(), {
      canvasId: created.canvasId,
      nodes: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, label: 'A' }],
      arrows: [{
        id: 'bad',
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        start: 'a',
        end: 'missing',
      }],
    });
    const body = parseResult(result);

    expect(result.isError).toBe(true);
    expect(body.reason).toBe('invalid_scene');
    expect(body.errors).toEqual(['arrow "bad" references unknown end node "missing"']);
  });

  it('requires materializeScene for coordinate scene generation', async () => {
    const created = parseResult(await handleExcalidrawCreateCanvas(ctx(), {}));
    const result = await handleExcalidrawSetScene(ctx({ materializeScene: undefined }), {
      canvasId: created.canvasId,
      nodes: [],
      arrows: [],
    });
    const body = parseResult(result);

    expect(result.isError).toBe(true);
    expect(body.reason).toBe('missing_capability');
    expect(body.message).toContain('materializeScene');
  });

  it('describes the stored coordinate scene when present', async () => {
    const created = parseResult(await handleExcalidrawCreateCanvas(ctx(), {}));
    await handleExcalidrawSetScene(ctx(), {
      canvasId: created.canvasId,
      nodes: [{ id: 'note', type: 'text', x: 12, y: 34, width: 160, height: 32, label: 'Free text' }],
      arrows: [],
    });

    const result = await handleExcalidrawDescribeCanvas(ctx(), { canvasId: created.canvasId });
    const body = parseResult(result);

    expect(body.graph).toEqual({ nodes: [], edges: [] });
    expect(body.sceneModelPath).toEndWith(`${created.canvasId}.scene.json`);
    expect(body.scene).toEqual({
      nodes: [{ id: 'note', type: 'text', x: 12, y: 34, width: 160, height: 32, label: 'Free text' }],
      arrows: [],
    });
  });
});

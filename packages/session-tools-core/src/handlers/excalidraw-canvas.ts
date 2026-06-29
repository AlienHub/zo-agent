/**
 * Excalidraw Canvas Handlers
 *
 * Stores coordinate-free graph structures as the agent work model, then
 * delegates DOM-dependent layout, styling, and materialization to a backend
 * capability.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ExcalidrawGraph, ExcalidrawScene, SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';

const MAX_CONSECUTIVE_FAILURES = 3;
const failureCounts = new Map<string, number>();

export interface ExcalidrawCreateCanvasArgs {
  title?: string;
}

export interface ExcalidrawSetGraphArgs extends ExcalidrawGraph {
  canvasId: string;
}

export interface ExcalidrawSetSceneArgs extends ExcalidrawScene {
  canvasId: string;
}

export interface ExcalidrawDescribeCanvasArgs {
  canvasId: string;
}

interface GraphDocument {
  canvasId: string;
  title?: string;
  graph: ExcalidrawGraph;
  updatedAt: string;
}

interface SceneDocument {
  canvasId: string;
  title?: string;
  scene: ExcalidrawScene;
  updatedAt: string;
}

export function resetExcalidrawFailureCountsForTest(): void {
  failureCounts.clear();
}

function jsonResponse(value: Record<string, unknown>, isError = false): ToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(value, null, 2),
    }],
    structuredContent: value,
    ...(isError ? { isError: true } : {}),
  };
}

function getSessionPath(ctx: SessionToolContext): string | null {
  return ctx.sessionPath ?? null;
}

function getCanvasesPath(ctx: SessionToolContext): string | null {
  const sessionPath = getSessionPath(ctx);
  return sessionPath ? join(sessionPath, 'canvases') : null;
}

function ensureCanvasesPath(ctx: SessionToolContext): string | null {
  const dir = getCanvasesPath(ctx);
  if (!dir) return null;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function validateCanvasId(canvasId: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(canvasId)) {
    return 'canvasId may only contain letters, numbers, hyphens, and underscores';
  }
  if (basename(canvasId) !== canvasId) {
    return 'canvasId must not contain path separators';
  }
  return null;
}

function getCanvasPaths(ctx: SessionToolContext, canvasId: string): {
  scenePath: string;
  graphPath: string;
  sceneModelPath: string;
  previewPngPath: string;
} | null {
  const dir = getCanvasesPath(ctx);
  if (!dir) return null;
  return {
    scenePath: join(dir, `${canvasId}.excalidraw`),
    graphPath: join(dir, `${canvasId}.graph.json`),
    sceneModelPath: join(dir, `${canvasId}.scene.json`),
    previewPngPath: join(dir, `${canvasId}.preview.png`),
  };
}

function readGraphDocument(ctx: SessionToolContext, canvasId: string): GraphDocument | null {
  const paths = getCanvasPaths(ctx, canvasId);
  if (!paths || !existsSync(paths.graphPath)) return null;
  return JSON.parse(readFileSync(paths.graphPath, 'utf-8')) as GraphDocument;
}

function writeGraphDocument(path: string, doc: GraphDocument): void {
  writeFileSync(path, JSON.stringify(doc, null, 2), 'utf-8');
}

function readSceneDocument(ctx: SessionToolContext, canvasId: string): SceneDocument | null {
  const paths = getCanvasPaths(ctx, canvasId);
  if (!paths || !existsSync(paths.sceneModelPath)) return null;
  return JSON.parse(readFileSync(paths.sceneModelPath, 'utf-8')) as SceneDocument;
}

function writeSceneDocument(path: string, doc: SceneDocument): void {
  writeFileSync(path, JSON.stringify(doc, null, 2), 'utf-8');
}

function failureKey(ctx: SessionToolContext, canvasId: string): string {
  return `${ctx.sessionId}:${canvasId}`;
}

function recordMaterializeFailure(
  ctx: SessionToolContext,
  canvasId: string,
  error: { reason: string; message: string },
  model: 'graph' | 'scene' = 'graph'
): ToolResult {
  const key = failureKey(ctx, canvasId);
  const failures = (failureCounts.get(key) ?? 0) + 1;
  failureCounts.set(key, failures);
  const terminal = failures >= MAX_CONSECUTIVE_FAILURES;

  return jsonResponse({
    ok: false,
    valid: false,
    terminal,
    failureCount: failures,
    maxFailures: MAX_CONSECUTIVE_FAILURES,
    reason: error.reason,
    message: terminal
      ? '画布生成失败，请调整需求或稍后再试'
      : error.message,
    instruction: terminal
      ? 'Stop retrying this canvas and tell the user: 画布生成失败，请调整需求或稍后再试'
      : model === 'graph'
        ? 'Fix the graph and call excalidraw_set_graph again.'
        : 'Fix the coordinate scene and call excalidraw_set_scene again.',
  }, true);
}

function resetFailures(ctx: SessionToolContext, canvasId: string): void {
  failureCounts.delete(failureKey(ctx, canvasId));
}

function toGraph(args: ExcalidrawSetGraphArgs): ExcalidrawGraph {
  return {
    nodes: args.nodes,
    edges: args.edges,
    ...(args.direction ? { direction: args.direction } : {}),
  };
}

function toScene(args: ExcalidrawSetSceneArgs, fallbackTitle?: string): ExcalidrawScene {
  return {
    nodes: args.nodes,
    arrows: args.arrows,
    ...(args.title ?? fallbackTitle ? { title: args.title ?? fallbackTitle } : {}),
  };
}

function validateScene(scene: ExcalidrawScene): string[] {
  const errors: string[] = [];
  const nodeIds = new Set<string>();
  const allIds = new Set<string>();

  for (const node of scene.nodes) {
    if (allIds.has(node.id)) errors.push(`duplicate scene element id "${node.id}"`);
    allIds.add(node.id);
    nodeIds.add(node.id);
  }

  for (const arrow of scene.arrows) {
    if (allIds.has(arrow.id)) errors.push(`duplicate scene element id "${arrow.id}"`);
    allIds.add(arrow.id);
    if (arrow.start && !nodeIds.has(arrow.start)) {
      errors.push(`arrow "${arrow.id}" references unknown start node "${arrow.start}"`);
    }
    if (arrow.end && !nodeIds.has(arrow.end)) {
      errors.push(`arrow "${arrow.id}" references unknown end node "${arrow.end}"`);
    }
  }

  return errors;
}

function writePreviewPng(path: string, previewPng?: string): string | undefined {
  if (!previewPng) return undefined;
  const base64 = previewPng.startsWith('data:')
    ? previewPng.slice(previewPng.indexOf(',') + 1)
    : previewPng;
  writeFileSync(path, Buffer.from(base64, 'base64'));
  return path;
}

export async function handleExcalidrawCreateCanvas(
  ctx: SessionToolContext,
  args: ExcalidrawCreateCanvasArgs
): Promise<ToolResult> {
  if (!ctx.materializeCanvas) {
    return jsonResponse({
      ok: false,
      reason: 'missing_capability',
      message: 'excalidraw_create_canvas requires materializeCanvas capability in the session tool context.',
    }, true);
  }

  const dir = ensureCanvasesPath(ctx);
  if (!dir) {
    return jsonResponse({
      ok: false,
      reason: 'missing_session_path',
      message: 'excalidraw_create_canvas requires sessionPath in the session tool context.',
    }, true);
  }

  const canvasId = `canvas-${randomUUID()}`;
  const paths = getCanvasPaths(ctx, canvasId)!;
  const emptyGraph: ExcalidrawGraph = { nodes: [], edges: [] };
  const materialized = await ctx.materializeCanvas(emptyGraph);
  if (!materialized.ok) {
    return jsonResponse({
      ok: false,
      reason: materialized.error.reason,
      message: materialized.error.message,
    }, true);
  }

  const graphDocument: GraphDocument = {
    canvasId,
    ...(args.title ? { title: args.title } : {}),
    graph: emptyGraph,
    updatedAt: new Date().toISOString(),
  };

  writeGraphDocument(paths.graphPath, graphDocument);
  writeFileSync(paths.scenePath, JSON.stringify(materialized.scene, null, 2), 'utf-8');
  const previewPngPath = writePreviewPng(paths.previewPngPath, materialized.previewPng);
  resetFailures(ctx, canvasId);

  return jsonResponse({
    ok: true,
    canvasId,
    path: paths.scenePath,
    graphPath: paths.graphPath,
    ...(previewPngPath ? { previewPngPath } : {}),
  });
}

export async function handleExcalidrawSetGraph(
  ctx: SessionToolContext,
  args: ExcalidrawSetGraphArgs
): Promise<ToolResult> {
  const canvasIdError = validateCanvasId(args.canvasId);
  if (canvasIdError) {
    return jsonResponse({ ok: false, reason: 'invalid_canvas_id', message: canvasIdError }, true);
  }
  if (!ctx.materializeCanvas) {
    return jsonResponse({
      ok: false,
      reason: 'missing_capability',
      message: 'excalidraw_set_graph requires materializeCanvas capability in the session tool context.',
    }, true);
  }

  const dir = ensureCanvasesPath(ctx);
  if (!dir) {
    return jsonResponse({
      ok: false,
      reason: 'missing_session_path',
      message: 'excalidraw_set_graph requires sessionPath in the session tool context.',
    }, true);
  }

  const paths = getCanvasPaths(ctx, args.canvasId)!;
  const existing = readGraphDocument(ctx, args.canvasId);
  if (!existing) {
    return jsonResponse({
      ok: false,
      reason: 'canvas_not_found',
      message: `Canvas ${args.canvasId} does not exist. Call excalidraw_create_canvas first.`,
    }, true);
  }

  const graph = toGraph(args);
  const nextGraphDocument: GraphDocument = {
    ...existing,
    graph,
    updatedAt: new Date().toISOString(),
  };
  writeGraphDocument(paths.graphPath, nextGraphDocument);

  const materialized = await ctx.materializeCanvas(graph);
  if (!materialized.ok) {
    return recordMaterializeFailure(ctx, args.canvasId, materialized.error);
  }

  writeFileSync(paths.scenePath, JSON.stringify(materialized.scene, null, 2), 'utf-8');
  const previewPngPath = writePreviewPng(paths.previewPngPath, materialized.previewPng);
  resetFailures(ctx, args.canvasId);
  await ctx.notifyResourceUpdated?.(paths.scenePath);

  return jsonResponse({
    ok: true,
    canvasId: args.canvasId,
    path: paths.scenePath,
    graphPath: paths.graphPath,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    ...(previewPngPath ? { previewPngPath } : {}),
  });
}

export async function handleExcalidrawSetScene(
  ctx: SessionToolContext,
  args: ExcalidrawSetSceneArgs
): Promise<ToolResult> {
  const canvasIdError = validateCanvasId(args.canvasId);
  if (canvasIdError) {
    return jsonResponse({ ok: false, reason: 'invalid_canvas_id', message: canvasIdError }, true);
  }
  if (!ctx.materializeScene) {
    return jsonResponse({
      ok: false,
      reason: 'missing_capability',
      message: 'excalidraw_set_scene requires materializeScene capability in the session tool context.',
    }, true);
  }

  const dir = ensureCanvasesPath(ctx);
  if (!dir) {
    return jsonResponse({
      ok: false,
      reason: 'missing_session_path',
      message: 'excalidraw_set_scene requires sessionPath in the session tool context.',
    }, true);
  }

  const paths = getCanvasPaths(ctx, args.canvasId)!;
  const existing = readGraphDocument(ctx, args.canvasId);
  if (!existing) {
    return jsonResponse({
      ok: false,
      reason: 'canvas_not_found',
      message: `Canvas ${args.canvasId} does not exist. Call excalidraw_create_canvas first.`,
    }, true);
  }

  const scene = toScene(args, existing.title);
  const validationErrors = validateScene(scene);
  if (validationErrors.length > 0) {
    return jsonResponse({
      ok: false,
      reason: 'invalid_scene',
      message: 'Coordinate scene validation failed.',
      errors: validationErrors,
    }, true);
  }

  const materialized = await ctx.materializeScene(scene);
  if (!materialized.ok) {
    return recordMaterializeFailure(ctx, args.canvasId, materialized.error, 'scene');
  }

  const sceneDocument: SceneDocument = {
    canvasId: args.canvasId,
    ...(scene.title ? { title: scene.title } : {}),
    scene,
    updatedAt: new Date().toISOString(),
  };
  writeSceneDocument(paths.sceneModelPath, sceneDocument);
  writeFileSync(paths.scenePath, JSON.stringify(materialized.scene, null, 2), 'utf-8');
  const previewPngPath = writePreviewPng(paths.previewPngPath, materialized.previewPng);
  resetFailures(ctx, args.canvasId);
  await ctx.notifyResourceUpdated?.(paths.scenePath);

  return jsonResponse({
    ok: true,
    canvasId: args.canvasId,
    path: paths.scenePath,
    sceneModelPath: paths.sceneModelPath,
    nodeCount: scene.nodes.length,
    arrowCount: scene.arrows.length,
    ...(previewPngPath ? { previewPngPath } : {}),
  });
}

export async function handleExcalidrawDescribeCanvas(
  ctx: SessionToolContext,
  args: ExcalidrawDescribeCanvasArgs
): Promise<ToolResult> {
  const canvasIdError = validateCanvasId(args.canvasId);
  if (canvasIdError) {
    return jsonResponse({ ok: false, reason: 'invalid_canvas_id', message: canvasIdError }, true);
  }

  const graphDocument = readGraphDocument(ctx, args.canvasId);
  if (!graphDocument) {
    return jsonResponse({
      ok: false,
      reason: 'canvas_not_found',
      message: `Canvas ${args.canvasId} does not exist.`,
    }, true);
  }

  const paths = getCanvasPaths(ctx, args.canvasId);
  const sceneDocument = readSceneDocument(ctx, args.canvasId);

  return jsonResponse({
    ok: true,
    canvasId: args.canvasId,
    title: graphDocument.title,
    graph: graphDocument.graph,
    ...(sceneDocument && paths ? {
      scene: sceneDocument.scene,
      sceneModelPath: paths.sceneModelPath,
    } : {}),
  });
}

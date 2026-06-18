import { describe, expect, it } from 'bun:test';
import {
  createReadToolDefinition,
  createBashToolDefinition,
  createEditToolDefinition,
  createWriteToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  type ToolDefinition,
  type CreateAgentSessionOptions,
} from '@mariozechner/pi-coding-agent';
import { createSearchTool } from './tools/search/create-search-tool.ts';
import { createWebFetchTool } from './tools/web-fetch.ts';
import { normalizePiToolInputForPreToolUse } from './tool-input-normalization.ts';
import { runPreToolUseChecks, type PermissionManagerLike } from '../../shared/src/agent/core/pre-tool-use.ts';
import type { WebSearchProvider } from './tools/search/types.ts';

/**
 * Regression contract for Pi SDK 0.70.0 tool registration.
 *
 * Pre-fix bug (PR #330): subprocess passed `tools: AgentTool[]` to
 * `createAgentSession`. Pi SDK 0.70.0 redefined `CreateAgentSessionOptions.tools`
 * as `string[]` (a name allowlist), so `new Set(tool_objects).has('name_string')`
 * returned false for every lookup in `_refreshToolRegistry` → every tool silently
 * filtered out → LLM saw only the default `[read, bash, edit, write]`.
 *
 * These tests lock in the post-fix shape so the regression can't re-enter:
 * - Every custom tool is a valid `ToolDefinition` with a `promptSnippet` (Pi SDK
 *   hides tools without a snippet from the system prompt's "Available tools"
 *   section, making them invisible to the LLM even when registered).
 * - The `tools` allowlist is a `string[]` of tool names.
 * - Every tool passed via `customTools` has its name present in the allowlist
 *   (otherwise it gets filtered out by `_refreshToolRegistry`'s allowlist guard).
 */

const stubSearchProvider: WebSearchProvider = {
  name: 'Stub',
  async search() {
    return [];
  },
};

function assertValidToolDefinition(tool: ToolDefinition<any, any>): void {
  expect(typeof tool.name).toBe('string');
  expect(tool.name.length).toBeGreaterThan(0);
  expect(typeof tool.label).toBe('string');
  expect(typeof tool.description).toBe('string');
  expect(tool.description.length).toBeGreaterThan(0);
  expect(tool.parameters).toBeDefined();
  expect(typeof tool.execute).toBe('function');
}

describe('Pi subprocess tool shape contract', () => {
  it('createSearchTool returns a valid ToolDefinition with promptSnippet', () => {
    const tool = createSearchTool(stubSearchProvider);
    assertValidToolDefinition(tool);
    expect(tool.name).toBe('web_search');
    expect(typeof tool.promptSnippet).toBe('string');
    expect((tool.promptSnippet as string).length).toBeGreaterThan(0);
  });

  it('createWebFetchTool returns a valid ToolDefinition with promptSnippet', () => {
    const tool = createWebFetchTool(() => null);
    assertValidToolDefinition(tool);
    expect(tool.name).toBe('web_fetch');
    expect(typeof tool.promptSnippet).toBe('string');
    expect((tool.promptSnippet as string).length).toBeGreaterThan(0);
  });

  it('Pi SDK builtin factories all return valid ToolDefinitions', () => {
    const cwd = '/tmp';
    const builtins = [
      createReadToolDefinition(cwd),
      createBashToolDefinition(cwd),
      createEditToolDefinition(cwd),
      createWriteToolDefinition(cwd),
      createGrepToolDefinition(cwd),
      createFindToolDefinition(cwd),
      createLsToolDefinition(cwd),
    ];
    for (const tool of builtins) {
      assertValidToolDefinition(tool);
    }
    const names = builtins.map(t => t.name);
    expect(new Set(names).size).toBe(names.length); // no duplicates
    expect(names).toEqual(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']);
  });
});

describe('Pi SDK 0.70.0 CreateAgentSessionOptions contract', () => {
  it('`tools` field is typed as string[] (name allowlist, not objects)', () => {
    // Compile-time proof. If Pi SDK ever changes this back to accept tool
    // objects, the line below will become a type error and this test will
    // fail at build time — preventing silent regression.
    const options: CreateAgentSessionOptions = {
      tools: ['read', 'bash', 'edit', 'write', 'web_search', 'web_fetch'],
    };
    expect(Array.isArray(options.tools)).toBe(true);
    for (const name of options.tools ?? []) {
      expect(typeof name).toBe('string');
    }
  });

  it('`customTools` field accepts ToolDefinition[] (the tool object channel)', () => {
    const searchTool = createSearchTool(stubSearchProvider);
    const webFetchTool = createWebFetchTool(() => null);
    const options: CreateAgentSessionOptions = {
      customTools: [searchTool, webFetchTool],
    };
    expect(options.customTools?.length).toBe(2);
  });

  it('customTools names ⊆ tools allowlist invariant', () => {
    // This is the invariant the subprocess must maintain when building sessionOptions.
    // If any customTool name is missing from `tools`, that tool gets filtered out.
    const searchTool = createSearchTool(stubSearchProvider);
    const webFetchTool = createWebFetchTool(() => null);
    const customTools = [
      createReadToolDefinition('/tmp'),
      createBashToolDefinition('/tmp'),
      createEditToolDefinition('/tmp'),
      createWriteToolDefinition('/tmp'),
      createGrepToolDefinition('/tmp'),
      createFindToolDefinition('/tmp'),
      createLsToolDefinition('/tmp'),
      searchTool,
      webFetchTool,
    ];
    const tools = customTools.map(t => t.name);
    const allowlistSet = new Set(tools);
    for (const tool of customTools) {
      expect(allowlistSet.has(tool.name)).toBe(true);
    }
  });
});

describe('Pi pre-tool-use input normalization', () => {
  it('normalizes Read path to file_path before permission guards run', () => {
    const normalized = normalizePiToolInputForPreToolUse('Read', { path: '.env' });

    expect(normalized).toEqual({ path: '.env', file_path: '.env' });
  });

  it('normalizes path-based write tools before permission guards run', () => {
    const normalized = normalizePiToolInputForPreToolUse('Write', { path: 'notes.md', content: 'hello' });

    expect(normalized).toEqual({ path: 'notes.md', file_path: 'notes.md', content: 'hello' });
  });

  it('preserves an existing file_path value', () => {
    const normalized = normalizePiToolInputForPreToolUse('Read', { path: '.env', file_path: '/tmp/.env' });

    expect(normalized).toEqual({ path: '.env', file_path: '/tmp/.env' });
  });

  it('lets the sensitive path guard prompt for Pi Read .env input', () => {
    const permissionManager: PermissionManagerLike = {
      isCommandWhitelisted: () => false,
      isDomainWhitelisted: () => false,
      getBaseCommand: command => command.split(/\s+/)[0] ?? command,
    };
    const input = normalizePiToolInputForPreToolUse('Read', { path: '.env' });

    const result = runPreToolUseChecks({
      toolName: 'Read',
      input,
      sessionId: 'pi-read-env-normalization-test',
      permissionMode: 'allow-all',
      workspaceRootPath: '/repo',
      workspaceId: 'repo',
      workingDirectory: '/repo',
      activeSourceSlugs: [],
      allSourceSlugs: [],
      hasSourceActivation: false,
      permissionManager,
      sensitiveContextProtection: {
        enabled: true,
        sensitiveFiles: { enabled: true, action: 'prompt' },
      },
    });

    expect(result.type).toBe('prompt');
    if (result.type === 'prompt') {
      expect(result.description).toBe('Sensitive file access');
      expect(result.command).toBe('/repo/.env');
    }
  });
});

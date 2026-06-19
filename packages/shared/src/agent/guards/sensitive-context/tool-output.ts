import { guardToolResult, formatSensitiveProtectionNotice } from './policy.ts';
import { writeSensitiveAuditEntry } from './audit.ts';
import type { PermissionMode, SensitiveContextProtectionConfig } from './types.ts';

/**
 * Best-effort extraction of the textual payload of a tool result for
 * sensitive-context scanning.
 *
 * Handles the common built-in shapes: plain strings (Bash/Grep/WebFetch text),
 * `{ stdout, stderr }` (Bash), `{ text }` / `{ content: [...] }` content blocks,
 * and `{ file: { content } }` (Read). Non-text blocks (e.g. `{ type: 'image' }`)
 * contribute nothing, so a pure image/binary result yields '' and is left
 * untouched.
 *
 * We deliberately do NOT `JSON.stringify` unknown objects — that would scan
 * base64 image payloads (producing false positives and risking corruption of
 * image reads). Unknown shapes return '' (no-op); structure-preserving redaction
 * of multimodal results is tracked as a follow-up.
 */
export function extractToolResponseText(resp: unknown): string {
  if (resp == null) return '';
  if (typeof resp === 'string') return resp;
  if (Array.isArray(resp)) {
    return resp.map(extractToolResponseText).join('');
  }
  if (typeof resp === 'object') {
    const o = resp as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
    const std: string[] = [];
    if (typeof o.stdout === 'string') std.push(o.stdout);
    if (typeof o.stderr === 'string') std.push(o.stderr);
    if (std.length > 0) return std.join('\n');
    const file = o.file;
    if (file && typeof file === 'object') {
      const content = (file as Record<string, unknown>).content;
      if (typeof content === 'string') return content;
    }
    if (Array.isArray(o.content)) return extractToolResponseText(o.content);
  }
  return '';
}

export interface ToolOutputRedaction {
  /** Replacement payload for the model (PostToolUse `updatedToolOutput`). Undefined = leave output unchanged. */
  updatedToolOutput?: string;
}

export interface ToolOutputGuardParams {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResponse: unknown;
  sessionId: string;
  permissionMode: PermissionMode;
  workingDirectory: string;
  sourceSlug?: string;
  config?: Partial<SensitiveContextProtectionConfig>;
  /** When provided, the guard decision is appended to the session audit log (best-effort). */
  audit?: { filePath: string; enabled: boolean };
}

/**
 * Backend-agnostic sensitive-context guard for a single tool result, shaped for
 * the Claude SDK PostToolUse hook (`updatedToolOutput` / `additionalContext`).
 * Returns `null` when the output should be left untouched.
 *
 * mcp__* tools are guarded upstream (McpClientPool / session-scoped-tools), so
 * callers should skip them — this helper does too, defensively.
 */
export function buildToolOutputRedaction(params: ToolOutputGuardParams): ToolOutputRedaction | null {
  const { toolName, toolResponse, config } = params;
  if (!toolName || toolName.startsWith('mcp__')) return null;
  if (config?.enabled === false) return null;

  const resultText = extractToolResponseText(toolResponse);
  if (!resultText) return null;

  const guarded = guardToolResult({
    sessionId: params.sessionId,
    toolName,
    toolInput: params.toolInput,
    resultText,
    permissionMode: params.permissionMode,
    sourceSlug: params.sourceSlug,
    workingDirectory: params.workingDirectory,
    config,
  });

  if (params.audit) {
    writeSensitiveAuditEntry({
      auditFilePath: params.audit.filePath,
      auditEnabled: params.audit.enabled,
      sessionId: params.sessionId,
      toolName,
      sourceSlug: params.sourceSlug,
      action: guarded.action,
      policyMode: guarded.policyMode,
      findings: guarded.findings,
    });
  }

  if (guarded.action === 'allow') return null;

  const updatedToolOutput = guarded.action === 'block'
    ? guarded.reason
    : `${formatSensitiveProtectionNotice(guarded)}${guarded.text ?? resultText}`;

  return { updatedToolOutput };
}

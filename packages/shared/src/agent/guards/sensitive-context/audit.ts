import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  SensitiveAuditEntry,
  SensitiveFinding,
  SensitiveProtectionMode,
  SensitiveAction,
} from './types.ts';

/** Canonical audit log path for a session's sensitive-context decisions. */
export function sensitiveAuditFilePath(sessionDir: string): string {
  return join(sessionDir, 'audit', 'sensitive-context.jsonl');
}

export function createSensitiveAuditEntry(input: {
  sessionId: string;
  toolName: string;
  sourceSlug?: string;
  action: SensitiveAction;
  policyMode: SensitiveProtectionMode;
  findings: SensitiveFinding[];
}): SensitiveAuditEntry {
  return {
    timestamp: new Date().toISOString(),
    sessionId: input.sessionId,
    toolName: input.toolName,
    sourceSlug: input.sourceSlug ?? null,
    action: input.action,
    policyMode: input.policyMode,
    findings: input.findings.map(finding => ({
      type: finding.type,
      severity: finding.severity,
      confidence: finding.confidence,
      count: finding.count,
    })),
    rawValueStored: false,
  };
}

export function appendSensitiveAuditEntry(path: string, entry: SensitiveAuditEntry): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, 'utf8');
}

/**
 * Shared, best-effort audit writer used by every guard call site so audit
 * coverage is consistent across backends. No-ops when auditing is disabled or
 * there are no findings, and never throws (auditing must not block tool flow).
 */
export function writeSensitiveAuditEntry(input: {
  auditFilePath: string;
  auditEnabled: boolean;
  sessionId: string;
  toolName: string;
  sourceSlug?: string;
  action: SensitiveAction;
  policyMode: SensitiveProtectionMode;
  findings: SensitiveFinding[];
}): void {
  if (!input.auditEnabled || input.findings.length === 0) return;
  try {
    const entry = createSensitiveAuditEntry({
      sessionId: input.sessionId,
      toolName: input.toolName,
      sourceSlug: input.sourceSlug,
      action: input.action,
      policyMode: input.policyMode,
      findings: input.findings,
    });
    appendSensitiveAuditEntry(input.auditFilePath, entry);
  } catch {
    // Best-effort: auditing must never break the tool result path.
  }
}

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  SensitiveAuditEntry,
  SensitiveFinding,
  SensitiveProtectionMode,
  SensitiveAction,
} from './types.ts';

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

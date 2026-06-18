import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSensitiveAuditEntry,
  guardToolResult,
  saveWorkspaceRedactionRules,
  type RedactionRulesFile,
  type SensitiveAction,
  type SensitiveContextProtectionConfig,
  type SensitiveFieldRuleSuggestion,
  type SensitiveFindingType,
  type SensitiveProtectionMode,
  type ToolResultGuardDecision,
} from './index.ts';
import {
  runPreToolUseChecks,
  type PermissionManagerLike,
  type PreToolUseCheckResult,
} from '../../core/pre-tool-use.ts';
import { setPermissionMode } from '../../mode-manager.ts';

interface ExpectedFinding {
  type: SensitiveFindingType;
  count?: number;
}

interface ExpectedDecision {
  action: ToolResultGuardDecision['action'];
  policyMode?: SensitiveProtectionMode;
  findings?: ExpectedFinding[];
  suggestions?: SensitiveFieldRuleSuggestion[];
  outputContains?: string[];
  outputNotContains?: string[];
}

interface ToolResultEvalCase {
  id: string;
  title: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  resultText: string;
  permissionMode: 'safe' | 'ask' | 'allow-all';
  sourceSlug?: string;
  config?: Partial<SensitiveContextProtectionConfig>;
  redactionRules?: RedactionRulesFile;
  expected: ExpectedDecision;
}

interface PathGuardEvalCase {
  id: string;
  title: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  workingDirectory?: string;
  config?: Partial<SensitiveContextProtectionConfig>;
  redactionRules?: RedactionRulesFile;
  expected: {
    action: 'allow' | 'block';
    prompt?: boolean;
    rule?: string;
    reasonContains?: string[];
  };
}

interface EgressEvalCase {
  id: string;
  title: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  permissionMode: 'safe' | 'ask' | 'allow-all';
  config?: Partial<SensitiveContextProtectionConfig>;
  expected: {
    action: 'allow' | 'prompt';
    promptType?: 'mcp_mutation' | 'api_mutation' | 'bash';
    command?: string;
    modifiedInputContains?: string[];
    modifiedInputNotContains?: string[];
    safePreviewContains?: string[];
    safePreviewNotContains?: string[];
  };
}

interface AuditEvalCase {
  id: string;
  title: string;
  inputCaseId: string;
  settings?: Partial<SensitiveContextProtectionConfig>;
  expected: {
    writesAudit: boolean;
    rawValueStored?: false;
    policyMode?: SensitiveProtectionMode;
    action?: SensitiveAction;
    findings?: ExpectedFinding[];
    entryContains?: string[];
    entryNotContains?: string[];
  };
}

function loadJsonlCases<T>(fileName: string): T[] {
  const filePath = join(import.meta.dir, 'evals', fileName);
  return readFileSync(filePath, 'utf-8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as ToolResultEvalCase;
      } catch (error) {
        throw new Error(`${fileName}:${index + 1} is not valid JSON: ${error}`);
      }
    }) as T[];
}

function materializeWorkspace(caseData: ToolResultEvalCase): string | undefined {
  if (!caseData.redactionRules) return undefined;

  const workspaceRoot = mkdtempSync(join(tmpdir(), 'sensitive-context-eval-'));
  writeFileSync(join(workspaceRoot, '.keep'), '', 'utf-8');
  saveWorkspaceRedactionRules(workspaceRoot, caseData.redactionRules);
  return workspaceRoot;
}

const permissionManager: PermissionManagerLike = {
  isCommandWhitelisted: () => false,
  isDangerousCommand: () => false,
  getBaseCommand: command => command.split(/\s+/)[0] ?? command,
  extractDomainFromNetworkCommand: () => null,
  isDomainWhitelisted: () => false,
};

function sourceSlugFromToolName(toolName: string): string | null {
  const match = /^mcp__([^_]+)__/.exec(toolName);
  return match?.[1] ?? null;
}

function preToolUseResultFor(
  caseData: PathGuardEvalCase | EgressEvalCase,
  workspaceRoot: string,
): PreToolUseCheckResult {
  const sourceSlug = sourceSlugFromToolName(caseData.toolName);
  const activeSourceSlugs = sourceSlug ? [sourceSlug] : [];
  const permissionMode = 'permissionMode' in caseData ? caseData.permissionMode : 'allow-all';
  const sessionId = `eval-${caseData.id}`;
  setPermissionMode(sessionId, permissionMode, { changedBy: 'restore' });

  return runPreToolUseChecks({
    toolName: caseData.toolName,
    input: caseData.toolInput,
    sessionId,
    permissionMode,
    workspaceRootPath: workspaceRoot,
    workspaceId: 'eval-workspace',
    workingDirectory: 'workingDirectory' in caseData ? caseData.workingDirectory : workspaceRoot,
    activeSourceSlugs,
    allSourceSlugs: activeSourceSlugs,
    hasSourceActivation: true,
    permissionManager,
    sensitiveContextProtection: caseData.config,
  });
}

function decisionText(decision: ToolResultGuardDecision): string {
  return 'text' in decision && typeof decision.text === 'string' ? decision.text : '';
}

function expectDecision(caseData: ToolResultEvalCase, decision: ToolResultGuardDecision): void {
  const expected = caseData.expected;
  expect(decision.action).toBe(expected.action);
  if (expected.policyMode) expect(decision.policyMode).toBe(expected.policyMode);

  for (const expectedFinding of expected.findings ?? []) {
    const finding = decision.findings.find(candidate => candidate.type === expectedFinding.type);
    expect(finding, `${caseData.id} expected finding ${expectedFinding.type}`).toBeTruthy();
    if (expectedFinding.count !== undefined) {
      expect(finding?.count).toBe(expectedFinding.count);
    }
  }

  if (expected.suggestions) {
    expect(decision.suggestions ?? []).toEqual(expected.suggestions);
  }

  const text = decisionText(decision);
  for (const value of expected.outputContains ?? []) {
    expect(text, `${caseData.id} output should contain ${value}`).toContain(value);
  }
  for (const value of expected.outputNotContains ?? []) {
    expect(text, `${caseData.id} output should not contain ${value}`).not.toContain(value);
  }
}

describe('Sensitive Context Protection eval cases', () => {
  const toolResultCases = [
    ...loadJsonlCases<ToolResultEvalCase>('tool-result-cases.jsonl'),
    ...loadJsonlCases<ToolResultEvalCase>('bypass-regression-cases.jsonl'),
  ];
  const toolResultCasesById = new Map(toolResultCases.map(caseData => [caseData.id, caseData]));
  const pathGuardCases = loadJsonlCases<PathGuardEvalCase>('path-guard-cases.jsonl');
  const egressCases = loadJsonlCases<EgressEvalCase>('egress-cases.jsonl');
  const auditCases = loadJsonlCases<AuditEvalCase>('audit-cases.jsonl');

  for (const caseData of toolResultCases) {
    it(`${caseData.id}: ${caseData.title}`, () => {
      const workspaceRoot = materializeWorkspace(caseData);
      try {
        const decision = guardToolResult({
          sessionId: `eval-${caseData.id}`,
          toolName: caseData.toolName,
          toolInput: caseData.toolInput,
          resultText: caseData.resultText,
          permissionMode: caseData.permissionMode,
          sourceSlug: caseData.sourceSlug,
          workingDirectory: workspaceRoot,
          config: caseData.config,
        });

        expectDecision(caseData, decision);
      } finally {
        if (workspaceRoot) rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });
  }

  for (const caseData of pathGuardCases) {
    it(`${caseData.id}: ${caseData.title}`, () => {
      const workspaceRoot = materializeWorkspace(caseData as ToolResultEvalCase) ?? mkdtempSync(join(tmpdir(), 'sensitive-context-path-eval-'));
      try {
        const result = preToolUseResultFor(caseData, workspaceRoot);
        if (caseData.expected.action === 'allow') {
          expect(result.type).toBe('allow');
        } else if (caseData.expected.prompt === false) {
          expect(result.type).toBe('block');
        } else {
          expect(['block', 'prompt']).toContain(result.type);
        }

        if (caseData.expected.reasonContains) {
          const reason = result.type === 'block' ? result.reason : result.type === 'prompt' ? result.reason ?? '' : '';
          for (const value of caseData.expected.reasonContains) {
            expect(reason).toContain(value);
          }
        }
      } finally {
        rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });
  }

  for (const caseData of egressCases) {
    it(`${caseData.id}: ${caseData.title}`, () => {
      const workspaceRoot = mkdtempSync(join(tmpdir(), 'sensitive-context-egress-eval-'));
      try {
        const result = preToolUseResultFor(caseData, workspaceRoot);
        expect(result.type).toBe(caseData.expected.action);
        if (caseData.expected.action === 'prompt') {
          expect(result.type).toBe('prompt');
          if (result.type === 'prompt') {
            if (caseData.expected.promptType) expect(result.promptType).toBe(caseData.expected.promptType);
            if (caseData.expected.command) expect(result.command).toBe(caseData.expected.command);
            const modifiedInput = JSON.stringify(result.modifiedInput);
            for (const value of caseData.expected.modifiedInputContains ?? []) {
              expect(modifiedInput).toContain(value);
            }
            for (const value of caseData.expected.modifiedInputNotContains ?? []) {
              expect(modifiedInput).not.toContain(value);
            }
            for (const value of caseData.expected.safePreviewContains ?? []) {
              expect(result.safePreview ?? '').toContain(value);
            }
            for (const value of caseData.expected.safePreviewNotContains ?? []) {
              expect(result.safePreview ?? '').not.toContain(value);
            }
          }
        }
      } finally {
        rmSync(workspaceRoot, { recursive: true, force: true });
      }
    });
  }

  for (const caseData of auditCases) {
    it(`${caseData.id}: ${caseData.title}`, () => {
      const inputCase = toolResultCasesById.get(caseData.inputCaseId);
      expect(inputCase, `${caseData.id} references missing input case`).toBeTruthy();
      if (!inputCase) return;

      const config = {
        ...inputCase.config,
        ...caseData.settings,
      };
      const decision = guardToolResult({
        sessionId: `eval-${caseData.id}`,
        toolName: inputCase.toolName,
        toolInput: inputCase.toolInput,
        resultText: inputCase.resultText,
        permissionMode: inputCase.permissionMode,
        sourceSlug: inputCase.sourceSlug,
        config,
      });

      const auditEnabled = config.audit?.enabled !== false;
      expect(auditEnabled).toBe(caseData.expected.writesAudit);
      if (!auditEnabled) return;

      const entry = createSensitiveAuditEntry({
        sessionId: `eval-${caseData.id}`,
        toolName: inputCase.toolName,
        sourceSlug: inputCase.sourceSlug,
        action: decision.action,
        policyMode: decision.policyMode,
        findings: decision.findings,
      });
      const serialized = JSON.stringify(entry);

      if (caseData.expected.rawValueStored !== undefined) {
        expect(entry.rawValueStored).toBe(caseData.expected.rawValueStored);
      }
      if (caseData.expected.policyMode) expect(entry.policyMode).toBe(caseData.expected.policyMode);
      if (caseData.expected.action) expect(entry.action).toBe(caseData.expected.action);
      for (const expectedFinding of caseData.expected.findings ?? []) {
        const finding = entry.findings.find(candidate => candidate.type === expectedFinding.type);
        expect(finding, `${caseData.id} expected audit finding ${expectedFinding.type}`).toBeTruthy();
        if (expectedFinding.count !== undefined) expect(finding?.count).toBe(expectedFinding.count);
      }
      for (const value of caseData.expected.entryContains ?? []) {
        expect(serialized).toContain(value);
      }
      for (const value of caseData.expected.entryNotContains ?? []) {
        expect(serialized).not.toContain(value);
      }
    });
  }
});

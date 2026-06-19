import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { safeJsonParse } from '../../../utils/files.ts';
import { getWorkspaceDataPath } from '../../../workspaces/layout.ts';

type RuleCreator = 'permission_prompt' | 'conversation';

export interface SensitivePathAllowRule {
  scope: 'workspace';
  kind: 'sensitive_path_allow';
  path: string;
  createdBy: RuleCreator;
  createdAt: string;
  note?: string;
}

export type RedactionRule = SensitivePathAllowRule;

export interface RedactionRulesFile {
  version: 1;
  rules: RedactionRule[];
}

export function getWorkspaceRedactionRulesPath(workspaceRootPath: string): string {
  return join(getWorkspaceDataPath(workspaceRootPath), 'redaction.json');
}

function isSensitivePathAllowRule(rule: unknown): rule is SensitivePathAllowRule {
  const candidate = rule as Partial<SensitivePathAllowRule> | null;
  return (
    candidate?.scope === 'workspace' &&
    candidate?.kind === 'sensitive_path_allow' &&
    typeof candidate?.path === 'string' &&
    candidate.path.length > 0
  );
}

export function loadWorkspaceRedactionRules(workspaceRootPath: string): RedactionRulesFile {
  const filePath = getWorkspaceRedactionRulesPath(workspaceRootPath);
  if (!existsSync(filePath)) return { version: 1, rules: [] };

  try {
    const parsed = safeJsonParse(readFileSync(filePath, 'utf-8')) as Partial<RedactionRulesFile>;
    return {
      version: 1,
      rules: Array.isArray(parsed.rules)
        ? parsed.rules.filter((rule): rule is RedactionRule => isSensitivePathAllowRule(rule))
        : [],
    };
  } catch {
    return { version: 1, rules: [] };
  }
}

export function saveWorkspaceRedactionRules(
  workspaceRootPath: string,
  rulesFile: RedactionRulesFile,
): void {
  const filePath = getWorkspaceRedactionRulesPath(workspaceRootPath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({ version: 1, rules: rulesFile.rules }, null, 2)}\n`, 'utf-8');
}

export function isSensitivePathPermanentlyAllowed(workspaceRootPath: string, path: string): boolean {
  return listSensitivePathAllowRules(workspaceRootPath).some(rule => rule.path === path);
}

export function listSensitivePathAllowRules(workspaceRootPath: string): SensitivePathAllowRule[] {
  return loadWorkspaceRedactionRules(workspaceRootPath).rules
    .filter((rule): rule is SensitivePathAllowRule => rule.kind === 'sensitive_path_allow');
}

export function addSensitivePathAllowRule(
  workspaceRootPath: string,
  path: string,
  createdBy: SensitivePathAllowRule['createdBy'] = 'permission_prompt',
): SensitivePathAllowRule[] {
  const rulesFile = loadWorkspaceRedactionRules(workspaceRootPath);
  if (!rulesFile.rules.some(rule => rule.kind === 'sensitive_path_allow' && rule.path === path)) {
    rulesFile.rules.push({
      scope: 'workspace',
      kind: 'sensitive_path_allow',
      path,
      createdBy,
      createdAt: new Date().toISOString(),
      note: 'Sensitive path permanently allowed from permission prompt.',
    });
    saveWorkspaceRedactionRules(workspaceRootPath, rulesFile);
  }
  return listSensitivePathAllowRules(workspaceRootPath);
}

export function removeSensitivePathAllowRule(
  workspaceRootPath: string,
  path: string,
): SensitivePathAllowRule[] {
  const rulesFile = loadWorkspaceRedactionRules(workspaceRootPath);
  rulesFile.rules = rulesFile.rules.filter(rule => rule.kind !== 'sensitive_path_allow' || rule.path !== path);
  saveWorkspaceRedactionRules(workspaceRootPath, rulesFile);
  return listSensitivePathAllowRules(workspaceRootPath);
}

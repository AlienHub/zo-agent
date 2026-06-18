import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
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

export interface FieldRedactionRule {
  scope: 'file' | 'source' | 'workspace';
  kind: 'field_redaction';
  match?: string;
  fields: string[];
  action: 'redact' | 'drop' | 'keep';
  createdBy: 'conversation';
  createdAt: string;
  note?: string;
}

export interface RedactionRulesFile {
  version: 1;
  rules: RedactionRule[];
}

export type RedactionRule = SensitivePathAllowRule | FieldRedactionRule;

export function getWorkspaceRedactionRulesPath(workspaceRootPath: string): string {
  return join(getWorkspaceDataPath(workspaceRootPath), 'redaction.json');
}

function safeSourceSlug(sourceSlug: string): string {
  return sourceSlug.replace(/[\\/]/g, '_');
}

export function getSourceRedactionRulesPath(workspaceRootPath: string, sourceSlug: string): string {
  return join(getWorkspaceDataPath(workspaceRootPath), 'sources', safeSourceSlug(sourceSlug), 'redaction.json');
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

function isFieldRedactionRule(rule: unknown): rule is FieldRedactionRule {
  const candidate = rule as Partial<FieldRedactionRule> | null;
  return (
    (candidate?.scope === 'file' || candidate?.scope === 'source' || candidate?.scope === 'workspace') &&
    candidate?.kind === 'field_redaction' &&
    (candidate.action === 'redact' || candidate.action === 'drop' || candidate.action === 'keep') &&
    Array.isArray(candidate.fields) &&
    candidate.fields.some(field => typeof field === 'string' && field.trim().length > 0) &&
    (candidate.scope === 'workspace' || candidate.scope === 'source' || typeof candidate.match === 'string')
  );
}

function normalizeFieldRule(rule: FieldRedactionRule): FieldRedactionRule {
  return {
    scope: rule.scope,
    kind: 'field_redaction',
    match: rule.scope === 'workspace' ? rule.match : rule.match?.trim(),
    fields: Array.from(new Set(rule.fields.map(field => field.trim()).filter(Boolean))),
    action: rule.action,
    createdBy: 'conversation',
    createdAt: typeof rule.createdAt === 'string' ? rule.createdAt : new Date().toISOString(),
    note: typeof rule.note === 'string' ? rule.note : undefined,
  };
}

export function loadWorkspaceRedactionRules(workspaceRootPath: string): RedactionRulesFile {
  const filePath = getWorkspaceRedactionRulesPath(workspaceRootPath);
  if (!existsSync(filePath)) return { version: 1, rules: [] };

  try {
    const parsed = safeJsonParse(readFileSync(filePath, 'utf-8')) as Partial<RedactionRulesFile>;
    return {
      version: 1,
      rules: Array.isArray(parsed.rules)
        ? parsed.rules
          .filter((rule): rule is RedactionRule => isSensitivePathAllowRule(rule) || isFieldRedactionRule(rule))
          .map(rule => rule.kind === 'field_redaction' ? normalizeFieldRule(rule) : rule)
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

export function loadSourceRedactionRules(workspaceRootPath: string, sourceSlug: string): RedactionRulesFile {
  const filePath = getSourceRedactionRulesPath(workspaceRootPath, sourceSlug);
  if (!existsSync(filePath)) return { version: 1, rules: [] };

  try {
    const parsed = safeJsonParse(readFileSync(filePath, 'utf-8')) as Partial<RedactionRulesFile>;
    const rules = Array.isArray(parsed.rules)
      ? parsed.rules
        .filter((rule): rule is FieldRedactionRule => isFieldRedactionRule(rule))
        .map(rule => normalizeFieldRule({
          ...rule,
          scope: rule.scope === 'workspace' ? 'source' : rule.scope,
          match: rule.match ?? sourceSlug,
        }))
      : [];
    return { version: 1, rules };
  } catch {
    return { version: 1, rules: [] };
  }
}

export function saveSourceRedactionRules(
  workspaceRootPath: string,
  sourceSlug: string,
  rulesFile: RedactionRulesFile,
): void {
  const filePath = getSourceRedactionRulesPath(workspaceRootPath, sourceSlug);
  mkdirSync(dirname(filePath), { recursive: true });
  const rules = rulesFile.rules.filter((rule): rule is FieldRedactionRule => rule.kind === 'field_redaction');
  writeFileSync(filePath, `${JSON.stringify({ version: 1, rules }, null, 2)}\n`, 'utf-8');
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

export function listFieldRedactionRules(workspaceRootPath: string): FieldRedactionRule[] {
  return loadWorkspaceRedactionRules(workspaceRootPath).rules
    .filter((rule): rule is FieldRedactionRule => rule.kind === 'field_redaction');
}

export function listSourceFieldRedactionRules(workspaceRootPath: string, sourceSlug: string): FieldRedactionRule[] {
  return loadSourceRedactionRules(workspaceRootPath, sourceSlug).rules
    .filter((rule): rule is FieldRedactionRule => rule.kind === 'field_redaction');
}

export function addFieldRedactionRule(
  workspaceRootPath: string,
  rule: Omit<FieldRedactionRule, 'kind' | 'createdAt' | 'createdBy'> & {
    createdAt?: string;
    note?: string;
  },
): FieldRedactionRule[] {
  const rulesFile = loadWorkspaceRedactionRules(workspaceRootPath);
  const nextRule = normalizeFieldRule({
    ...rule,
    kind: 'field_redaction',
    createdBy: 'conversation',
    createdAt: rule.createdAt ?? new Date().toISOString(),
  });

  rulesFile.rules = rulesFile.rules.filter(existing => {
    if (existing.kind !== 'field_redaction') return true;
    return !(
      existing.scope === nextRule.scope &&
      existing.match === nextRule.match &&
      existing.action === nextRule.action &&
      existing.fields.join('\u0000') === nextRule.fields.join('\u0000')
    );
  });
  rulesFile.rules.push(nextRule);
  saveWorkspaceRedactionRules(workspaceRootPath, rulesFile);
  return listFieldRedactionRules(workspaceRootPath);
}

export function addSourceFieldRedactionRule(
  workspaceRootPath: string,
  sourceSlug: string,
  rule: Omit<FieldRedactionRule, 'kind' | 'createdAt' | 'createdBy' | 'scope' | 'match'> & {
    match?: string;
    createdAt?: string;
    note?: string;
  },
): FieldRedactionRule[] {
  const rulesFile = loadSourceRedactionRules(workspaceRootPath, sourceSlug);
  const nextRule = normalizeFieldRule({
    ...rule,
    scope: 'source',
    kind: 'field_redaction',
    match: rule.match ?? sourceSlug,
    createdBy: 'conversation',
    createdAt: rule.createdAt ?? new Date().toISOString(),
  });

  rulesFile.rules = rulesFile.rules.filter(existing => {
    if (existing.kind !== 'field_redaction') return true;
    return !(
      existing.scope === nextRule.scope &&
      existing.match === nextRule.match &&
      existing.action === nextRule.action &&
      existing.fields.join('\u0000') === nextRule.fields.join('\u0000')
    );
  });
  rulesFile.rules.push(nextRule);
  saveSourceRedactionRules(workspaceRootPath, sourceSlug, rulesFile);
  return listSourceFieldRedactionRules(workspaceRootPath, sourceSlug);
}

export function removeFieldRedactionRule(
  workspaceRootPath: string,
  rule: Pick<FieldRedactionRule, 'scope' | 'action' | 'fields'> & { match?: string },
): FieldRedactionRule[] {
  const normalizedFields = rule.fields.map(field => field.trim()).filter(Boolean).join('\u0000');
  const rulesFile = loadWorkspaceRedactionRules(workspaceRootPath);
  rulesFile.rules = rulesFile.rules.filter(existing => {
    if (existing.kind !== 'field_redaction') return true;
    return !(
      existing.scope === rule.scope &&
      existing.match === rule.match &&
      existing.action === rule.action &&
      existing.fields.join('\u0000') === normalizedFields
    );
  });
  saveWorkspaceRedactionRules(workspaceRootPath, rulesFile);
  return listFieldRedactionRules(workspaceRootPath);
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function globMatches(pattern: string, value: string): boolean {
  return globToRegExp(pattern.replace(/\\/g, '/')).test(value.replace(/\\/g, '/'));
}

export function getApplicableFieldRedactionRules(
  rules: FieldRedactionRule[],
  context: { filePath?: string; sourceSlug?: string },
): FieldRedactionRule[] {
  return rules.filter(rule => {
    if (rule.scope === 'workspace') return true;
    if (!rule.match) return false;
    if (rule.scope === 'source') return !!context.sourceSlug && globMatches(rule.match, context.sourceSlug);
    if (!context.filePath) return false;
    const normalizedPath = context.filePath.replace(/\\/g, '/');
    return globMatches(rule.match, normalizedPath) || globMatches(rule.match, basename(normalizedPath));
  });
}

import type { SensitiveFieldRuleSuggestion, SensitiveFinding, SensitiveFindingType } from './types.ts';
import type { FieldRedactionRule } from './redaction-rules.ts';

interface FieldRedactionStats {
  type: SensitiveFindingType;
  count: number;
}

export interface StructuredFieldRedactionResult {
  text: string;
  findings: SensitiveFinding[];
  suggestions: SensitiveFieldRuleSuggestion[];
}

interface FieldRuleMatch {
  type: SensitiveFindingType;
  replacement: string;
  action: 'redact' | 'drop' | 'keep';
}

export interface StructuredFieldRedactionOptions {
  rules?: FieldRedactionRule[];
}

const FIELD_RULES: Array<{ type: SensitiveFindingType; regex: RegExp; replacement: string }> = [
  { type: 'private_key', regex: /(^|[_\s-])private[_\s-]*key($|[_\s-])/i, replacement: '[REDACTED:PRIVATE_KEY]' },
  { type: 'oauth_token', regex: /(^|[_\s-])(authorization|bearer|oauth|access[_\s-]*token|auth[_\s-]*token|refresh[_\s-]*token)($|[_\s-])/i, replacement: '[REDACTED:TOKEN]' },
  { type: 'api_key', regex: /(^|[_\s-])(api[_\s-]*key|client[_\s-]*secret|secret[_\s-]*key)($|[_\s-])/i, replacement: '[REDACTED:API_KEY]' },
  { type: 'password', regex: /(^|[_\s-])(password|passwd|pwd)($|[_\s-])/i, replacement: '[REDACTED:PASSWORD]' },
  { type: 'credit_card', regex: /(^|[_\s-])(credit[_\s-]*card|card[_\s-]*number|pan)($|[_\s-])/i, replacement: '[REDACTED:CREDIT_CARD]' },
  { type: 'phone', regex: /(^|[_\s-])(phone|mobile|tel|telephone|手机号|手机)($|[_\s-])/i, replacement: '[REDACTED:PHONE]' },
  { type: 'email', regex: /(^|[_\s-])(email|e-mail|mail|邮箱)($|[_\s-])/i, replacement: '[REDACTED:EMAIL]' },
  { type: 'id_number', regex: /(^|[_\s-])(ssn|sin|national[_\s-]*id|id[_\s-]*number|身份证)($|[_\s-])/i, replacement: '[REDACTED:ID_NUMBER]' },
];

const SUGGESTION_RULES: Array<{ regex: RegExp; reason: string }> = [
  { regex: /(^|[_\s-])(salary|compensation|pay|wage|income|薪资|工资)($|[_\s-])/i, reason: 'compensation field' },
  { regex: /(^|[_\s-])(address|street|home[_\s-]*address|住址|地址)($|[_\s-])/i, reason: 'address field' },
  { regex: /(^|[_\s-])(dob|birth[_\s-]*date|birthday|date[_\s-]*of[_\s-]*birth|生日|出生日期)($|[_\s-])/i, reason: 'date of birth field' },
  { regex: /(^|[_\s-])(passport|passport[_\s-]*number|护照)($|[_\s-])/i, reason: 'passport field' },
  { regex: /(^|[_\s-])(bank[_\s-]*account|iban|routing[_\s-]*number|银行卡|银行账号)($|[_\s-])/i, reason: 'bank account field' },
];

function defaultRuleForField(fieldName: string) {
  return FIELD_RULES.find(rule => rule.regex.test(fieldName));
}

function customRuleForField(fieldName: string, rules: FieldRedactionRule[]): FieldRuleMatch | null {
  const normalizedField = fieldName.trim().toLowerCase();
  for (const rule of [...rules].reverse()) {
    if (!rule.fields.some(field => field.trim().toLowerCase() === normalizedField)) continue;
    const defaultRule = defaultRuleForField(fieldName);
    return {
      type: defaultRule?.type ?? 'unknown_secret',
      replacement: defaultRule?.replacement ?? '[REDACTED:FIELD]',
      action: rule.action,
    };
  }
  return null;
}

function ruleForField(fieldName: string, rules: FieldRedactionRule[] = []): FieldRuleMatch | null {
  const customRule = customRuleForField(fieldName, rules);
  if (customRule) return customRule;

  const defaultRule = defaultRuleForField(fieldName);
  return defaultRule
    ? { ...defaultRule, action: 'redact' }
    : null;
}

function hasConfiguredFieldRule(fieldName: string, rules: FieldRedactionRule[]): boolean {
  const normalizedField = fieldName.trim().toLowerCase();
  return rules.some(rule => rule.fields.some(field => field.trim().toLowerCase() === normalizedField));
}

function suggestionForField(fieldName: string, rules: FieldRedactionRule[]): SensitiveFieldRuleSuggestion | null {
  const field = fieldName.trim();
  if (!field || ruleForField(field, rules) || hasConfiguredFieldRule(field, rules)) return null;

  const suggestion = SUGGESTION_RULES.find(rule => rule.regex.test(field));
  return suggestion ? { field, reason: suggestion.reason } : null;
}

function protectionRuleForField(fieldName: string, rules: FieldRedactionRule[] = []): FieldRuleMatch | null {
  const explicitRule = ruleForField(fieldName, rules);
  if (explicitRule) return explicitRule;

  const suggestion = suggestionForField(fieldName, rules);
  return suggestion
    ? { type: 'unknown_secret', replacement: '[REDACTED:FIELD]', action: 'redact' }
    : null;
}

function mergeSuggestions(suggestions: SensitiveFieldRuleSuggestion[]): SensitiveFieldRuleSuggestion[] {
  const byField = new Map<string, SensitiveFieldRuleSuggestion>();
  for (const suggestion of suggestions) {
    const key = suggestion.field.trim().toLowerCase();
    if (!byField.has(key)) byField.set(key, suggestion);
  }
  return Array.from(byField.values());
}

function collectJsonFieldSuggestions(value: unknown, rules: FieldRedactionRule[], output: SensitiveFieldRuleSuggestion[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectJsonFieldSuggestions(item, rules, output);
    return;
  }

  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    const suggestion = suggestionForField(key, rules);
    if (suggestion) output.push(suggestion);
    collectJsonFieldSuggestions(child, rules, output);
  }
}

function toFindings(stats: FieldRedactionStats[]): SensitiveFinding[] {
  return stats.map(stat => ({
    type: stat.type,
    severity: stat.type === 'private_key' || stat.type === 'api_key' || stat.type === 'oauth_token'
      ? 'high'
      : 'medium',
    confidence: 'high',
    count: stat.count,
  }));
}

function addStat(stats: Map<SensitiveFindingType, number>, type: SensitiveFindingType) {
  stats.set(type, (stats.get(type) ?? 0) + 1);
}

function redactJsonValue(
  value: unknown,
  stats: Map<SensitiveFindingType, number>,
  keyHint?: string,
  rules: FieldRedactionRule[] = [],
): unknown {
  const rule = keyHint ? protectionRuleForField(keyHint, rules) : undefined;

  if (rule?.action === 'redact' && value !== null && value !== undefined && typeof value !== 'object') {
    addStat(stats, rule.type);
    return rule.replacement;
  }

  if (Array.isArray(value)) {
    return value.map(item => redactJsonValue(item, stats, keyHint, rules));
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const childRule = protectionRuleForField(key, rules);
      if (childRule?.action === 'drop') {
        addStat(stats, childRule.type);
        continue;
      }
      output[key] = redactJsonValue(child, stats, key, rules);
    }
    return output;
  }

  return value;
}

function tryRedactJson(text: string, rules: FieldRedactionRule[]): StructuredFieldRedactionResult | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const stats = new Map<SensitiveFindingType, number>();
    const suggestions: SensitiveFieldRuleSuggestion[] = [];
    collectJsonFieldSuggestions(parsed, rules, suggestions);
    const redacted = redactJsonValue(parsed, stats, undefined, rules);
    if (stats.size === 0) return { text, findings: [], suggestions: mergeSuggestions(suggestions) };
    return {
      text: JSON.stringify(redacted, null, 2),
      findings: toFindings(Array.from(stats, ([type, count]) => ({ type, count }))),
      suggestions: mergeSuggestions(suggestions),
    };
  } catch {
    return null;
  }
}

function tryRedactNdjson(text: string, rules: FieldRedactionRule[]): StructuredFieldRedactionResult | null {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2 || !lines.every(line => line.trim() === '' || line.trim().startsWith('{'))) return null;

  const stats = new Map<SensitiveFindingType, number>();
  const redactedLines: string[] = [];
  const suggestions: SensitiveFieldRuleSuggestion[] = [];
  let parsedAny = false;

  for (const line of lines) {
    if (line.trim() === '') {
      redactedLines.push(line);
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      parsedAny = true;
      collectJsonFieldSuggestions(parsed, rules, suggestions);
      redactedLines.push(JSON.stringify(redactJsonValue(parsed, stats, undefined, rules)));
    } catch {
      return null;
    }
  }

  if (!parsedAny) return null;
  return {
    text: stats.size === 0 ? text : redactedLines.join('\n'),
    findings: toFindings(Array.from(stats, ([type, count]) => ({ type, count }))),
    suggestions: mergeSuggestions(suggestions),
  };
}

function parseDelimitedLine(line: string, delimiter: ',' | '\t'): string[] {
  if (delimiter === '\t') return line.split('\t');

  const cells: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function serializeDelimitedLine(cells: string[], delimiter: ',' | '\t'): string {
  if (delimiter === '\t') return cells.join('\t');
  return cells.map(cell => (
    /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
  )).join(',');
}

function tryRedactDelimited(text: string, delimiter: ',' | '\t', rules: FieldRedactionRule[]): StructuredFieldRedactionResult | null {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return null;

  const headers = parseDelimitedLine(lines[0] ?? '', delimiter);
  if (headers.length < 2) return null;
  const suggestions = mergeSuggestions(
    headers
      .map(header => suggestionForField(header, rules))
      .filter((suggestion): suggestion is SensitiveFieldRuleSuggestion => !!suggestion),
  );

  const sensitiveColumns = headers
    .map((header, index) => ({ index, rule: protectionRuleForField(header.trim(), rules) }))
    .filter((entry): entry is { index: number; rule: FieldRuleMatch } => !!entry.rule && entry.rule.action !== 'keep')
    .sort((a, b) => b.index - a.index);

  const dropColumns = sensitiveColumns
    .filter(entry => entry.rule.action === 'drop')
    .map(entry => entry.index);
  const redactColumns = sensitiveColumns
    .filter(entry => entry.rule.action === 'redact')
    .filter((entry): entry is { index: number; rule: NonNullable<ReturnType<typeof ruleForField>> } => !!entry.rule);

  if (sensitiveColumns.length === 0) return suggestions.length > 0
    ? { text, findings: [], suggestions }
    : null;

  const stats = new Map<SensitiveFindingType, number>();
  const outputHeaders = [...headers];
  for (const index of dropColumns) outputHeaders.splice(index, 1);
  const output = [serializeDelimitedLine(outputHeaders, delimiter)];

  for (const line of lines.slice(1)) {
    if (line.trim() === '') {
      output.push(line);
      continue;
    }

    const cells = parseDelimitedLine(line, delimiter);
    for (const { index, rule } of redactColumns) {
      if (cells[index] === undefined || cells[index] === '') continue;
      cells[index] = rule.replacement;
      addStat(stats, rule.type);
    }
    for (const index of dropColumns) {
      if (cells[index] !== undefined) {
        const rule = sensitiveColumns.find(entry => entry.index === index)?.rule;
        if (rule) addStat(stats, rule.type);
        cells.splice(index, 1);
      }
    }
    output.push(serializeDelimitedLine(cells, delimiter));
  }

  return {
    text: stats.size === 0 ? text : output.join('\n'),
    findings: toFindings(Array.from(stats, ([type, count]) => ({ type, count }))),
    suggestions,
  };
}

export function redactStructuredSensitiveFields(
  text: string,
  options: StructuredFieldRedactionOptions = {},
): StructuredFieldRedactionResult {
  const rules = options.rules ?? [];
  const json = tryRedactJson(text, rules);
  if (json) return json;

  const ndjson = tryRedactNdjson(text, rules);
  if (ndjson) return ndjson;

  const delimiter = text.includes('\t') ? '\t' : ',';
  const delimited = tryRedactDelimited(text, delimiter, rules);
  if (delimited) return delimited;

  return { text, findings: [], suggestions: [] };
}

import { scanSensitiveText } from './scanner.ts';
import { redactSensitiveText } from './redact.ts';
import { redactStructuredSensitiveFields } from './field-redaction.ts';
import {
  getApplicableFieldRedactionRules,
  listFieldRedactionRules,
  listSourceFieldRedactionRules,
  type FieldRedactionRule,
} from './redaction-rules.ts';
import type {
  SensitiveAction,
  SensitiveContextProtectionConfig,
  SensitiveFieldRuleSuggestion,
  SensitiveFinding,
  SensitiveMatch,
  SensitiveProtectionMode,
  ToolResultGuardDecision,
  ToolResultGuardInput,
} from './types.ts';

export const DEFAULT_SENSITIVE_CONTEXT_PROTECTION_CONFIG: SensitiveContextProtectionConfig = {
  enabled: true,
  sensitiveFiles: {
    enabled: true,
    action: 'prompt',
  },
  outputRedaction: {
    enabled: true,
  },
  fieldRedaction: {
    enabled: true,
  },
  egressConfirmation: {
    enabled: false,
  },
  mode: 'balanced',
  credentialFiles: {
    enabled: true,
    action: 'prompt',
  },
  secrets: {
    enabled: true,
    action: 'redact',
  },
  privateKeys: {
    enabled: true,
    action: 'block',
  },
  pii: {
    enabled: true,
    action: 'redact',
  },
  lowConfidence: {
    action: 'allow',
  },
  audit: {
    enabled: true,
    storeRawValues: false,
  },
  customPatterns: [],
};

export function resolveSensitiveContextConfig(
  override?: Partial<SensitiveContextProtectionConfig>,
): SensitiveContextProtectionConfig {
  const legacyCredentialAction = override?.credentialFiles?.action;
  const sensitiveFiles = {
    enabled: override?.sensitiveFiles?.enabled ?? override?.credentialFiles?.enabled ?? true,
    action: override?.sensitiveFiles?.action
      ?? (legacyCredentialAction === 'block' || legacyCredentialAction === 'prompt' ? legacyCredentialAction : undefined)
      ?? 'prompt',
  };
  const outputRedaction = {
    enabled: override?.outputRedaction?.enabled ?? true,
  };
  const fieldRedaction = {
    enabled: override?.fieldRedaction?.enabled ?? true,
  };
  const egressConfirmation = {
    enabled: false,
  };

  return {
    ...DEFAULT_SENSITIVE_CONTEXT_PROTECTION_CONFIG,
    ...override,
    sensitiveFiles,
    outputRedaction,
    fieldRedaction,
    egressConfirmation,
    mode: override?.mode ?? DEFAULT_SENSITIVE_CONTEXT_PROTECTION_CONFIG.mode,
    credentialFiles: {
      ...DEFAULT_SENSITIVE_CONTEXT_PROTECTION_CONFIG.credentialFiles,
      ...override?.credentialFiles,
      enabled: sensitiveFiles.enabled,
      action: sensitiveFiles.action,
    },
    secrets: {
      ...DEFAULT_SENSITIVE_CONTEXT_PROTECTION_CONFIG.secrets,
      ...override?.secrets,
      enabled: outputRedaction.enabled && (override?.secrets?.enabled ?? DEFAULT_SENSITIVE_CONTEXT_PROTECTION_CONFIG.secrets.enabled),
    },
    privateKeys: {
      ...DEFAULT_SENSITIVE_CONTEXT_PROTECTION_CONFIG.privateKeys,
      ...override?.privateKeys,
      enabled: outputRedaction.enabled && (override?.privateKeys?.enabled ?? DEFAULT_SENSITIVE_CONTEXT_PROTECTION_CONFIG.privateKeys.enabled),
    },
    pii: {
      ...DEFAULT_SENSITIVE_CONTEXT_PROTECTION_CONFIG.pii,
      ...override?.pii,
      enabled: outputRedaction.enabled && (override?.pii?.enabled ?? DEFAULT_SENSITIVE_CONTEXT_PROTECTION_CONFIG.pii.enabled),
    },
    lowConfidence: {
      ...DEFAULT_SENSITIVE_CONTEXT_PROTECTION_CONFIG.lowConfidence,
      ...override?.lowConfidence,
    },
    audit: {
      ...DEFAULT_SENSITIVE_CONTEXT_PROTECTION_CONFIG.audit,
      ...override?.audit,
      storeRawValues: false,
    },
    customPatterns: override?.customPatterns ?? DEFAULT_SENSITIVE_CONTEXT_PROTECTION_CONFIG.customPatterns,
  };
}

function isPiiFinding(finding: SensitiveFinding): boolean {
  return finding.type === 'email' || finding.type === 'phone' || finding.type === 'id_number' || finding.type === 'credit_card';
}

function isPrivateKeyFinding(finding: SensitiveFinding): boolean {
  return finding.type === 'private_key';
}

function isSecretFinding(finding: SensitiveFinding): boolean {
  return !isPiiFinding(finding) && !isPrivateKeyFinding(finding);
}

function aggregateMatches(matches: SensitiveMatch[]): SensitiveFinding[] {
  const grouped = new Map<string, SensitiveFinding>();

  for (const match of matches) {
    const key = `${match.type}:${match.severity}:${match.confidence}`;
    const location = { line: match.line, start: match.start, end: match.end };
    const existing = grouped.get(key);

    if (existing) {
      existing.count += 1;
      existing.locations?.push(location);
    } else {
      grouped.set(key, {
        type: match.type,
        severity: match.severity,
        confidence: match.confidence,
        count: 1,
        locations: [location],
      });
    }
  }

  return Array.from(grouped.values());
}

function configuredActionForFinding(
  finding: SensitiveFinding,
  mode: SensitiveProtectionMode,
  config: SensitiveContextProtectionConfig,
): SensitiveAction {
  if (finding.confidence === 'low') {
    return config.lowConfidence.action;
  }

  if (isPiiFinding(finding)) {
    return config.pii.enabled ? config.pii.action : 'allow';
  }

  if (isPrivateKeyFinding(finding)) {
    if (!config.privateKeys.enabled) return 'allow';
    if (mode === 'strict' && config.privateKeys.action !== 'allow') return 'block';
    return config.privateKeys.action;
  }

  if (!config.secrets.enabled) return 'allow';

  if (
    mode === 'strict' &&
    config.secrets.action !== 'allow' &&
    finding.confidence === 'high' &&
    (finding.severity === 'high' || finding.severity === 'critical')
  ) {
    return 'block';
  }

  if (
    mode === 'strict' &&
    config.secrets.action !== 'allow' &&
    finding.confidence === 'medium'
  ) {
    return 'prompt';
  }

  return config.secrets.action;
}

function policyModeFor(input: ToolResultGuardInput, config: SensitiveContextProtectionConfig): SensitiveProtectionMode {
  if (input.permissionMode === 'safe') return 'strict';
  if (input.permissionMode === 'allow-all' && config.mode === 'strict') return 'balanced';
  return config.mode ?? 'balanced';
}

function filePathFromToolInput(input: Record<string, unknown>): string | undefined {
  const value = input.file_path ?? input.path ?? input.notebook_path;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function loadApplicableFieldRules(input: ToolResultGuardInput): FieldRedactionRule[] {
  if (!input.workingDirectory) return [];
  try {
    const rules = [
      ...listFieldRedactionRules(input.workingDirectory),
      ...(input.sourceSlug ? listSourceFieldRedactionRules(input.workingDirectory, input.sourceSlug) : []),
    ];
    return getApplicableFieldRedactionRules(
      rules,
      {
        filePath: filePathFromToolInput(input.toolInput),
        sourceSlug: input.sourceSlug,
      },
    );
  } catch {
    return [];
  }
}

export function guardToolResult(input: ToolResultGuardInput): ToolResultGuardDecision {
  const config = resolveSensitiveContextConfig(input.config);
  const mode = policyModeFor(input, config);

  if (!config.enabled || (config.outputRedaction?.enabled === false && config.fieldRedaction?.enabled === false)) {
    return { action: 'allow', text: input.resultText, findings: [], policyMode: mode };
  }

  const fieldRedaction = config.fieldRedaction?.enabled === false
    ? { text: input.resultText, findings: [] as SensitiveFinding[], suggestions: [] as SensitiveFieldRuleSuggestion[] }
    : redactStructuredSensitiveFields(input.resultText, { rules: loadApplicableFieldRules(input) });
  const textAfterFieldRedaction = fieldRedaction.text;
  const scan = config.outputRedaction?.enabled === false
    ? { findings: [] as SensitiveFinding[], matches: [] as SensitiveMatch[] }
    : scanSensitiveText(textAfterFieldRedaction);
  if (scan.findings.length === 0 && fieldRedaction.findings.length === 0) {
    return { action: 'allow', text: input.resultText, findings: [], policyMode: mode, suggestions: fieldRedaction.suggestions };
  }

  const actionByType = new Map(scan.findings.map(finding => [
    finding.type,
    configuredActionForFinding(finding, mode, config),
  ]));
  const protectedMatches = scan.matches.filter(match => actionByType.get(match.type) !== 'allow');
  const protectedFindings = [
    ...fieldRedaction.findings,
    ...aggregateMatches(protectedMatches),
  ];

  if (protectedFindings.length === 0) {
    return { action: 'allow', text: input.resultText, findings: [...fieldRedaction.findings, ...scan.findings], policyMode: mode, suggestions: fieldRedaction.suggestions };
  }

  if (protectedFindings.some(finding => actionByType.get(finding.type) === 'block')) {
    const hasPrivateKey = protectedFindings.some(isPrivateKeyFinding);
    const hasSecret = protectedFindings.some(isSecretFinding);
    return {
      action: 'block',
      reason: hasPrivateKey || hasSecret
        ? 'Sensitive result blocked: this tool result contains high-confidence secret material.'
        : 'Sensitive result blocked: this tool result contains sensitive data.',
      findings: protectedFindings,
      policyMode: mode,
      suggestions: fieldRedaction.suggestions,
    };
  }

  const redactedText = redactSensitiveText(textAfterFieldRedaction, protectedMatches);

  if (protectedFindings.some(finding => actionByType.get(finding.type) === 'prompt')) {
    return {
      action: 'prompt',
      reason: 'The tool result may contain sensitive data.',
      text: redactedText,
      findings: protectedFindings,
      policyMode: mode,
      suggestions: fieldRedaction.suggestions,
    };
  }

  return {
    action: 'redact',
    text: redactedText,
    findings: protectedFindings,
    policyMode: mode,
    suggestions: fieldRedaction.suggestions,
  };
}

function findingCount(findings: SensitiveFinding[]): number {
  return findings.reduce((total, finding) => total + finding.count, 0);
}

function summarizeFindings(findings: SensitiveFinding[]): string {
  return findings
    .map(finding => `${finding.type} x${finding.count}`)
    .join(', ');
}

export function formatSensitiveProtectionNotice(
  decision: Extract<ToolResultGuardDecision, { action: 'redact' | 'prompt' }>,
): string {
  const count = findingCount(decision.findings);
  const summary = summarizeFindings(decision.findings);
  const reason = decision.action === 'prompt'
    ? 'Sensitive content requires confirmation; a redacted result was sent to the model.'
    : `${count} sensitive item(s) were removed before this tool result was sent to the model.`;

  return [
    'Sensitive data redacted',
    reason,
    summary ? `Reason: ${summary}. Raw values were not stored.` : 'Raw values were not stored.',
    '',
    '',
  ].join('\n');
}

export function formatFieldRuleSuggestionNotice(
  suggestions: SensitiveFieldRuleSuggestion[] | undefined,
): string {
  if (!suggestions?.length) return '';

  const fields = suggestions
    .map(suggestion => `${suggestion.field} (${suggestion.reason})`)
    .join(', ');

  return [
    'Sensitive field rule suggestion',
    `Possible sensitive structured fields detected: ${fields}.`,
    'Ask the user whether to save a redaction rule before treating these fields as safe to expose. Raw values were not stored.',
    '',
    '',
  ].join('\n');
}

import { scanSensitiveText } from './scanner.ts';
import { redactSensitiveText } from './redact.ts';
import type {
  SensitiveAction,
  SensitiveContextProtectionConfig,
  SensitiveFinding,
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
  audit: {
    enabled: true,
    storeRawValues: false,
  },
};

export function resolveSensitiveContextConfig(
  override?: Partial<SensitiveContextProtectionConfig>,
): SensitiveContextProtectionConfig {
  const base = DEFAULT_SENSITIVE_CONTEXT_PROTECTION_CONFIG;
  const legacyCredentialAction = override?.credentialFiles?.action;
  const sensitiveFiles = {
    enabled: override?.sensitiveFiles?.enabled ?? override?.credentialFiles?.enabled ?? base.sensitiveFiles!.enabled,
    action: override?.sensitiveFiles?.action
      ?? (legacyCredentialAction === 'block' || legacyCredentialAction === 'prompt' ? legacyCredentialAction : undefined)
      ?? base.sensitiveFiles!.action,
  };
  const outputRedaction = {
    enabled: override?.outputRedaction?.enabled ?? base.outputRedaction!.enabled,
  };

  return {
    enabled: override?.enabled ?? base.enabled,
    sensitiveFiles,
    outputRedaction,
    credentialFiles: {
      enabled: sensitiveFiles.enabled,
      action: sensitiveFiles.action,
    },
    secrets: {
      ...base.secrets,
      ...override?.secrets,
      enabled: outputRedaction.enabled && (override?.secrets?.enabled ?? base.secrets.enabled),
    },
    privateKeys: {
      ...base.privateKeys,
      ...override?.privateKeys,
      enabled: outputRedaction.enabled && (override?.privateKeys?.enabled ?? base.privateKeys.enabled),
    },
    audit: {
      ...base.audit,
      ...override?.audit,
      storeRawValues: false,
    },
  };
}

function isPrivateKeyFinding(finding: SensitiveFinding): boolean {
  return finding.type === 'private_key';
}

function configuredActionForFinding(
  finding: SensitiveFinding,
  config: SensitiveContextProtectionConfig,
): SensitiveAction {
  if (isPrivateKeyFinding(finding)) {
    return config.privateKeys.enabled ? config.privateKeys.action : 'allow';
  }
  return config.secrets.enabled ? config.secrets.action : 'allow';
}

/** Fixed policy mode — modes were removed; secrets always redact, private keys always block. */
const POLICY_MODE: SensitiveProtectionMode = 'personal';

export function guardToolResult(input: ToolResultGuardInput): ToolResultGuardDecision {
  const config = resolveSensitiveContextConfig(input.config);

  if (!config.enabled || config.outputRedaction?.enabled === false) {
    return { action: 'allow', text: input.resultText, findings: [], policyMode: POLICY_MODE };
  }

  const scan = scanSensitiveText(input.resultText);
  if (scan.findings.length === 0) {
    return { action: 'allow', text: input.resultText, findings: [], policyMode: POLICY_MODE };
  }

  const actionByType = new Map(scan.findings.map(finding => [
    finding.type,
    configuredActionForFinding(finding, config),
  ]));
  const protectedMatches = scan.matches.filter(match => actionByType.get(match.type) !== 'allow');
  const protectedFindings = scan.findings.filter(finding => actionByType.get(finding.type) !== 'allow');

  if (protectedFindings.length === 0) {
    return { action: 'allow', text: input.resultText, findings: scan.findings, policyMode: POLICY_MODE };
  }

  if (protectedFindings.some(finding => actionByType.get(finding.type) === 'block')) {
    return {
      action: 'block',
      reason: 'Sensitive result blocked: this tool result contains high-confidence secret material.',
      findings: protectedFindings,
      policyMode: POLICY_MODE,
    };
  }

  return {
    action: 'redact',
    text: redactSensitiveText(input.resultText, protectedMatches),
    findings: protectedFindings,
    policyMode: POLICY_MODE,
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
  decision: Extract<ToolResultGuardDecision, { action: 'redact' }>,
): string {
  const count = findingCount(decision.findings);
  const summary = summarizeFindings(decision.findings);

  return [
    'Sensitive data redacted',
    `${count} secret value(s) were removed before this tool result was sent to the model.`,
    summary ? `Reason: ${summary}. Raw values were not stored.` : 'Raw values were not stored.',
    '',
    '',
  ].join('\n');
}

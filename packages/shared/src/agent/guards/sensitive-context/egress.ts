import { redactSensitiveText } from './redact.ts';
import { scanSensitiveText } from './scanner.ts';
import type {
  SensitiveContextProtectionConfig,
  SensitiveFinding,
  SensitiveProtectionMode,
} from './types.ts';
import { resolveSensitiveContextConfig } from './policy.ts';

export interface SensitiveEgressPrompt {
  promptType: 'bash' | 'mcp_mutation' | 'api_mutation';
  description: string;
  command: string;
  reason: string;
  impact: string;
  safePreview: string;
  modifiedInput: Record<string, unknown>;
  findings: SensitiveFinding[];
  policyMode: SensitiveProtectionMode;
}

function isExternalMutation(toolName: string, input: Record<string, unknown>): 'bash' | 'mcp_mutation' | 'api_mutation' | null {
  if (toolName.startsWith('mcp__')) return 'mcp_mutation';

  if (toolName.startsWith('api_')) {
    const method = typeof input.method === 'string' ? input.method.toUpperCase() : 'GET';
    return method === 'GET' ? null : 'api_mutation';
  }

  if (toolName === 'Bash' && typeof input.command === 'string') {
    const command = input.command;
    if (/\b(curl|wget)\b/i.test(command) && /(\s-X\s*(POST|PUT|PATCH)|--request\s+(POST|PUT|PATCH)|--data(?:-raw|-binary|-urlencode)?\b|-d\s)/i.test(command)) {
      return 'bash';
    }
  }

  return null;
}

function redactUnknown(value: unknown): unknown {
  if (typeof value === 'string') {
    const scan = scanSensitiveText(value);
    return scan.matches.length > 0 ? redactSensitiveText(value, scan.matches) : value;
  }

  if (Array.isArray(value)) {
    return value.map(redactUnknown);
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = redactUnknown(child);
    }
    return output;
  }

  return value;
}

function summarizeFindings(findings: SensitiveFinding[]): string {
  return findings
    .map(finding => `${finding.type} x${finding.count}`)
    .join(', ');
}

function describeDestination(toolName: string, input: Record<string, unknown>, promptType: SensitiveEgressPrompt['promptType']): string {
  if (promptType === 'api_mutation') {
    const method = typeof input.method === 'string' ? input.method.toUpperCase() : 'POST';
    const path = typeof input.path === 'string' ? input.path : '';
    return `${method} ${path}`.trim();
  }

  if (promptType === 'mcp_mutation') {
    return toolName.replace('mcp__', '').replace(/__/g, '/');
  }

  return typeof input.command === 'string' ? input.command : toolName;
}

function formatSafePreview(value: Record<string, unknown>): string {
  const text = JSON.stringify(value, null, 2);
  const maxLength = 2000;
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...` : text;
}

export function buildSensitiveEgressPrompt(
  toolName: string,
  input: Record<string, unknown>,
  configOverride?: Partial<SensitiveContextProtectionConfig>,
): SensitiveEgressPrompt | null {
  const config = resolveSensitiveContextConfig(configOverride);
  const promptType = isExternalMutation(toolName, input);
  if (!promptType || !config.enabled || config.egressConfirmation?.enabled === false) return null;

  const serialized = JSON.stringify(input);
  if (!serialized) return null;

  const scan = scanSensitiveText(serialized);
  if (scan.findings.length === 0) return null;

  const destination = describeDestination(toolName, input, promptType);
  return {
    promptType,
    description: `Sensitive external send: ${destination}`,
    command: destination,
    reason: `This outbound tool call contains sensitive data (${summarizeFindings(scan.findings)}).`,
    impact: 'Approving sends a redacted version of the tool input. Denying cancels the external send.',
    modifiedInput: redactUnknown(input) as Record<string, unknown>,
    findings: scan.findings,
    policyMode: config.mode ?? 'balanced',
    safePreview: formatSafePreview(redactUnknown(input) as Record<string, unknown>),
  };
}

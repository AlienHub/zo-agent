export type SensitiveFindingType =
  | 'api_key'
  | 'jwt'
  | 'private_key'
  | 'password'
  | 'oauth_token'
  | 'aws_access_key'
  | 'github_token'
  | 'slack_token'
  | 'stripe_key'
  | 'anthropic_key'
  | 'openai_key'
  | 'credential_file'
  | 'unknown_secret';

export type SensitiveSeverity = 'low' | 'medium' | 'high' | 'critical';
export type SensitiveConfidence = 'low' | 'medium' | 'high';
export type SensitiveAction = 'allow' | 'redact' | 'block' | 'prompt';
export type SensitiveProtectionMode = 'personal' | 'balanced' | 'strict';
export type PermissionMode = 'safe' | 'ask' | 'allow-all';

export interface SensitiveLocation {
  line?: number;
  start?: number;
  end?: number;
}

export interface SensitiveFinding {
  type: SensitiveFindingType;
  severity: SensitiveSeverity;
  confidence: SensitiveConfidence;
  count: number;
  locations?: SensitiveLocation[];
}

export interface SensitiveMatch {
  type: SensitiveFindingType;
  severity: SensitiveSeverity;
  confidence: SensitiveConfidence;
  start: number;
  end: number;
  line: number;
  replacement: string;
}

export interface SensitiveScannerResult {
  findings: SensitiveFinding[];
  matches: SensitiveMatch[];
}

/**
 * Credential safety net configuration. Scope is deliberately narrow:
 * block credential files before tools run, and redact high-confidence secrets
 * (API keys, private keys, tokens) from tool output before they reach the model.
 */
export interface SensitiveContextProtectionConfig {
  enabled: boolean;
  /** Pre-execution guard for credential files (.env, *.pem, .ssh/, .aws/credentials, …). */
  sensitiveFiles?: {
    enabled: boolean;
    action: 'prompt' | 'block';
  };
  /** Redact secrets in tool output before they enter model context. */
  outputRedaction?: {
    enabled: boolean;
  };
  /** Legacy alias for sensitiveFiles (kept for back-compat with older configs). */
  credentialFiles: {
    enabled: boolean;
    action: SensitiveAction;
  };
  secrets: {
    enabled: boolean;
    action: SensitiveAction;
  };
  privateKeys: {
    enabled: boolean;
    action: SensitiveAction;
  };
  audit: {
    enabled: boolean;
    storeRawValues: false;
  };
}

export interface ToolResultGuardInput {
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  resultText: string;
  permissionMode: PermissionMode;
  sourceSlug?: string;
  workingDirectory?: string;
  config?: Partial<SensitiveContextProtectionConfig>;
}

export type ToolResultGuardDecision =
  | { action: 'allow'; text: string; findings: SensitiveFinding[]; policyMode: SensitiveProtectionMode }
  | { action: 'redact'; text: string; findings: SensitiveFinding[]; policyMode: SensitiveProtectionMode }
  | { action: 'block'; reason: string; findings: SensitiveFinding[]; policyMode: SensitiveProtectionMode };

export interface SensitivePathGuardResult {
  action: 'allow' | 'block';
  reason?: string;
  finding?: SensitiveFinding;
  rule?: string;
  path?: string;
  recommendedAction?: 'prompt' | 'block';
}

export interface SensitiveAuditEntry {
  timestamp: string;
  sessionId: string;
  toolName: string;
  sourceSlug: string | null;
  action: SensitiveAction;
  policyMode: SensitiveProtectionMode;
  findings: Array<{
    type: SensitiveFindingType;
    severity: SensitiveSeverity;
    confidence: SensitiveConfidence;
    count: number;
  }>;
  rawValueStored: false;
}

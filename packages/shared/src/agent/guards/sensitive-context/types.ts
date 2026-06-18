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
  | 'email'
  | 'phone'
  | 'id_number'
  | 'credit_card'
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

export interface SensitiveFieldRuleSuggestion {
  field: string;
  reason: string;
}

export interface SensitiveContextProtectionConfig {
  enabled: boolean;
  sensitiveFiles?: {
    enabled: boolean;
    action: 'prompt' | 'block';
  };
  outputRedaction?: {
    enabled: boolean;
  };
  fieldRedaction?: {
    enabled: boolean;
  };
  egressConfirmation?: {
    enabled: boolean;
  };
  mode?: SensitiveProtectionMode;
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
  pii: {
    enabled: boolean;
    action: SensitiveAction;
  };
  lowConfidence: {
    action: SensitiveAction;
  };
  audit: {
    enabled: boolean;
    storeRawValues: false;
  };
  customPatterns: Array<{
    name: string;
    pattern: string;
    type: SensitiveFindingType;
    severity: SensitiveSeverity;
    action: SensitiveAction;
  }>;
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
  | { action: 'allow'; text: string; findings: SensitiveFinding[]; policyMode: SensitiveProtectionMode; suggestions?: SensitiveFieldRuleSuggestion[] }
  | { action: 'redact'; text: string; findings: SensitiveFinding[]; policyMode: SensitiveProtectionMode; suggestions?: SensitiveFieldRuleSuggestion[] }
  | { action: 'block'; reason: string; findings: SensitiveFinding[]; policyMode: SensitiveProtectionMode; suggestions?: SensitiveFieldRuleSuggestion[] }
  | { action: 'prompt'; reason: string; text?: string; findings: SensitiveFinding[]; policyMode: SensitiveProtectionMode; suggestions?: SensitiveFieldRuleSuggestion[] };

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

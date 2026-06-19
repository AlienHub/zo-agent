/**
 * Config Types (Browser-safe)
 *
 * Pure type definitions for configuration.
 * Re-exports from @craft-agent/core for compatibility.
 */

// Re-export all config types from core (single source of truth)
export type {
  Workspace,
  McpAuthType,
  AuthType,
  OAuthCredentials,
} from '@craft-agent/core/types';

/** App-level network proxy configuration. */
export interface NetworkProxySettings {
  enabled: boolean;
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
}

export type SensitiveContextProtectionAction = 'allow' | 'redact' | 'block' | 'prompt';

export interface SensitiveFeatureToggle {
  enabled: boolean;
}

/**
 * App-level credential safety net configuration. Scope is deliberately narrow:
 * block credential files before tools run, and redact high-confidence secrets
 * (API keys, private keys, tokens) from tool output before they reach the model.
 */
export interface SensitiveContextProtectionSettings {
  enabled: boolean;
  /** Protect .env, private keys, cloud credentials, and similar files before tools run. */
  sensitiveFiles: {
    enabled: boolean;
    action: Extract<SensitiveContextProtectionAction, 'prompt' | 'block'>;
  };
  /** Redact secrets in tool results before they enter model context. */
  outputRedaction: SensitiveFeatureToggle;
  audit: {
    enabled: boolean;
    storeRawValues: false;
  };

  /** Legacy alias for sensitiveFiles, kept for back-compat with older configs. */
  credentialFiles: {
    enabled: boolean;
    action: SensitiveContextProtectionAction;
  };
  secrets: {
    enabled: boolean;
    action: SensitiveContextProtectionAction;
  };
  privateKeys: {
    enabled: boolean;
    action: SensitiveContextProtectionAction;
  };
}

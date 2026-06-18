import { resolve } from 'node:path';
import type { SensitivePathGuardResult } from './types.ts';

const SENSITIVE_BASENAME_PATTERNS: Array<{ rule: string; regex: RegExp; recommendedAction: 'prompt' | 'block' }> = [
  { rule: '.env', regex: /^\.env(?:\..*)?$/, recommendedAction: 'prompt' },
  { rule: '*.pem', regex: /\.pem$/i, recommendedAction: 'block' },
  { rule: '*.key', regex: /\.key$/i, recommendedAction: 'block' },
  { rule: '*.p12', regex: /\.p12$/i, recommendedAction: 'block' },
  { rule: '*.pfx', regex: /\.pfx$/i, recommendedAction: 'block' },
  { rule: 'id_rsa', regex: /^id_rsa$/, recommendedAction: 'block' },
  { rule: 'id_ed25519', regex: /^id_ed25519$/, recommendedAction: 'block' },
  { rule: '.npmrc', regex: /^\.npmrc$/, recommendedAction: 'prompt' },
  { rule: '.pypirc', regex: /^\.pypirc$/, recommendedAction: 'prompt' },
  { rule: '.netrc', regex: /^\.netrc$/, recommendedAction: 'prompt' },
  { rule: 'kubeconfig', regex: /^kubeconfig$/i, recommendedAction: 'prompt' },
  { rule: 'credentials.json', regex: /^credentials\.json$/i, recommendedAction: 'prompt' },
  { rule: 'service-account*.json', regex: /^service-account.*\.json$/i, recommendedAction: 'prompt' },
];

const SENSITIVE_PATH_SEGMENTS: Array<{ rule: string; segments: string[]; recommendedAction: 'prompt' | 'block' }> = [
  { rule: '.ssh/**', segments: ['.ssh'], recommendedAction: 'block' },
  { rule: '.aws/credentials', segments: ['.aws', 'credentials'], recommendedAction: 'prompt' },
  { rule: '.aws/config', segments: ['.aws', 'config'], recommendedAction: 'prompt' },
  { rule: '.gcp/**', segments: ['.gcp'], recommendedAction: 'prompt' },
  { rule: '.azure/**', segments: ['.azure'], recommendedAction: 'prompt' },
  { rule: '.docker/config.json', segments: ['.docker', 'config.json'], recommendedAction: 'prompt' },
  { rule: '.kube/config', segments: ['.kube', 'config'], recommendedAction: 'prompt' },
];

function normalizeCandidatePath(path: string, baseDir: string): string {
  if (path.startsWith('~')) return path;
  return resolve(baseDir, path);
}

function splitSegments(path: string): string[] {
  return path.replace(/\\/g, '/').split('/').filter(Boolean);
}

function includesSegmentSequence(segments: string[], sequence: string[]): boolean {
  const normalized = segments.map(segment => segment.toLowerCase());
  const expected = sequence.map(segment => segment.toLowerCase());

  for (let i = 0; i <= normalized.length - expected.length; i += 1) {
    if (expected.every((segment, offset) => normalized[i + offset] === segment)) {
      return true;
    }
  }
  return false;
}

function checkPath(path: string, baseDir: string): SensitivePathGuardResult {
  const normalizedPath = normalizeCandidatePath(path, baseDir);
  const segments = splitSegments(normalizedPath);
  const basename = segments.at(-1) ?? normalizedPath;

  for (const pattern of SENSITIVE_BASENAME_PATTERNS) {
    if (pattern.regex.test(basename)) {
      return buildBlockResult(normalizedPath, pattern.rule, pattern.recommendedAction);
    }
  }

  for (const pattern of SENSITIVE_PATH_SEGMENTS) {
    if (includesSegmentSequence(segments, pattern.segments)) {
      return buildBlockResult(normalizedPath, pattern.rule, pattern.recommendedAction);
    }
  }

  return { action: 'allow' };
}

function buildBlockResult(
  path: string,
  rule: string,
  recommendedAction: 'prompt' | 'block',
): SensitivePathGuardResult {
  return {
    action: 'block',
    path,
    rule,
    recommendedAction,
    reason: [
      'Sensitive path blocked',
      `Tool target: ${path}`,
      `Matched sensitive credential file rule: ${rule}`,
      'The file contents were not read or sent to the model.',
    ].join('\n'),
    finding: {
      type: 'credential_file',
      severity: 'critical',
      confidence: 'high',
      count: 1,
    },
  };
}

export function guardSensitiveToolPath(
  toolName: string,
  input: Record<string, unknown>,
  workingDirectory: string,
): SensitivePathGuardResult {
  if (toolName === 'Read') {
    const path = typeof input.file_path === 'string'
      ? input.file_path
      : typeof input.path === 'string'
        ? input.path
        : undefined;
    if (path) return checkPath(path, workingDirectory);
  }

  if (toolName === 'Bash' && typeof input.command === 'string') {
    const tokenRegex = /'([^']+)'|"([^"]+)"|([^\s'";|&()<>]+)/g;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(input.command)) !== null) {
      const candidate = (match[1] ?? match[2] ?? match[3] ?? '').trim();
      if (!candidate || candidate.startsWith('-')) continue;

      const result = checkPath(candidate, workingDirectory);
      if (result.action === 'block') {
        return result;
      }
    }
  }

  return { action: 'allow' };
}

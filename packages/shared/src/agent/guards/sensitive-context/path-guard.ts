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
      'This is a security policy. Do not attempt to bypass it via other tools, interpreters (python/node/etc.), scripts, encoding, or alternate paths. If the user needs this information, ask them to provide it manually.',
    ].join('\n'),
    finding: {
      type: 'credential_file',
      severity: 'critical',
      confidence: 'high',
      count: 1,
    },
  };
}

/**
 * Best-effort detection of sensitive paths embedded in inline interpreter code
 * (e.g. `python3 -c "open(os.path.join(os.environ['HOME'], '.ssh', 'id_rsa'))"`).
 *
 * The token-based path check above only sees literal path arguments; an
 * interpreter can construct the path programmatically so the literal `.ssh`
 * never appears as a standalone path segment. This is a defense-in-depth layer,
 * NOT a hard boundary — base64, dynamic string assembly, or fetching the path
 * from elsewhere will still slip through. The authoritative control remains the
 * tool-result content scanner (which inspects what was actually read). Markers
 * here are chosen to be low false-positive inside interpreter code: `.env` is
 * matched only as a filename (so `os.environ` / `process.env` do NOT trigger),
 * and `.key` is omitted entirely (too common as a property name).
 */
// Boundaries: a "dotfile" marker counts only when it isn't part of a longer
// identifier. LEAD excludes word chars, `.`, and `-` (so `os.environ` /
// `process.env` / `config.env` do NOT match), but allows `/`, quotes, `=`, `;`,
// etc. as separators. TRAIL excludes word chars and `-` (so `.sshfoo` /
// `.environment` don't match) but treats `.`, `/`, `;`, space, quotes as ends.
const LEAD = `(?:^|[^A-Za-z0-9_.\\-])`;
const TRAIL = `(?=$|[^A-Za-z0-9_-])`;
const SENSITIVE_TEXT_MARKERS: Array<{ rule: string; regex: RegExp; recommendedAction: 'prompt' | 'block' }> = [
  { rule: '.ssh/**', regex: new RegExp(`${LEAD}\\.ssh${TRAIL}`), recommendedAction: 'block' },
  { rule: 'id_rsa', regex: /\bid_rsa\b/, recommendedAction: 'block' },
  { rule: 'id_ed25519', regex: /\bid_ed25519\b/, recommendedAction: 'block' },
  { rule: '*.pem', regex: new RegExp(`\\.pem${TRAIL}`, 'i'), recommendedAction: 'block' },
  { rule: '*.p12', regex: new RegExp(`\\.p12${TRAIL}`, 'i'), recommendedAction: 'block' },
  { rule: '*.pfx', regex: new RegExp(`\\.pfx${TRAIL}`, 'i'), recommendedAction: 'block' },
  { rule: '.aws/credentials', regex: new RegExp(`${LEAD}\\.aws${TRAIL}`), recommendedAction: 'prompt' },
  { rule: '.gcp/**', regex: new RegExp(`${LEAD}\\.gcp${TRAIL}`), recommendedAction: 'prompt' },
  { rule: '.azure/**', regex: new RegExp(`${LEAD}\\.azure${TRAIL}`), recommendedAction: 'prompt' },
  { rule: '.kube/config', regex: new RegExp(`${LEAD}\\.kube${TRAIL}`), recommendedAction: 'prompt' },
  { rule: 'kubeconfig', regex: /\bkubeconfig\b/i, recommendedAction: 'prompt' },
  { rule: '.netrc', regex: new RegExp(`${LEAD}\\.netrc${TRAIL}`), recommendedAction: 'prompt' },
  { rule: '.pypirc', regex: new RegExp(`${LEAD}\\.pypirc${TRAIL}`), recommendedAction: 'prompt' },
  { rule: '.npmrc', regex: new RegExp(`${LEAD}\\.npmrc${TRAIL}`), recommendedAction: 'prompt' },
  { rule: 'credentials.json', regex: /\bcredentials\.json\b/i, recommendedAction: 'prompt' },
  { rule: 'service-account*.json', regex: /\bservice-account[\w-]*\.json\b/i, recommendedAction: 'prompt' },
  { rule: '.env', regex: new RegExp(`${LEAD}\\.env(?:\\.[\\w-]+)?${TRAIL}`), recommendedAction: 'prompt' },
];

/** Matches an interpreter/shell invoked with inline code, where a path can be assembled at runtime. */
const INLINE_INTERPRETER_REGEX = /\b(?:python3?|node|nodejs|deno|bun|ruby|perl|php|lua|osascript|gawk|awk|sh|bash|zsh|ksh|fish)\b/i;
const INLINE_CODE_FLAG_REGEX = /(?:^|\s)-(?:c|e)\b|--eval\b|<<-?\s*['"]?[A-Za-z_]/;

function scanInterpreterCommandForSensitiveMarkers(command: string): SensitivePathGuardResult | null {
  if (!INLINE_INTERPRETER_REGEX.test(command) || !INLINE_CODE_FLAG_REGEX.test(command)) {
    return null;
  }
  for (const marker of SENSITIVE_TEXT_MARKERS) {
    if (marker.regex.test(command)) {
      return buildBlockResult(command, marker.rule, marker.recommendedAction);
    }
  }
  return null;
}

// File tools that take an explicit path/glob and can read a credential file's
// contents into model context (Grep/Read), or open/modify one (Edit/Write/…).
// All are gated so a credential file can't be slurped via `Grep --path .env`,
// `Edit .env`, etc. — not just `Read`.
const FILE_PATH_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'Edit',
  'MultiEdit',
  'Write',
  'NotebookEdit',
]);

/**
 * Check a glob/pattern selector (e.g. Grep `glob` or Glob `pattern`) for
 * credential-file targeting. A glob like `.env*`, `*.pem`, `**​/id_rsa` would
 * otherwise restrict a search to credential files while the `path` argument
 * stays innocuous (e.g. the repo root). We reduce the glob to its final segment,
 * strip glob metacharacters, and run the basename rules on the result.
 */
function checkGlobSelector(glob: string): SensitivePathGuardResult {
  const lastSegment = glob.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? glob;
  const candidate = lastSegment.replace(/[*?{}[\]!]/g, '');
  if (!candidate || candidate === '.') return { action: 'allow' };
  for (const pattern of SENSITIVE_BASENAME_PATTERNS) {
    if (pattern.regex.test(candidate)) {
      return buildBlockResult(glob, pattern.rule, pattern.recommendedAction);
    }
  }
  return { action: 'allow' };
}

export function guardSensitiveToolPath(
  toolName: string,
  input: Record<string, unknown>,
  workingDirectory: string,
): SensitivePathGuardResult {
  if (FILE_PATH_TOOLS.has(toolName)) {
    const candidates = [input.file_path, input.path, input.notebook_path]
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    for (const path of candidates) {
      const result = checkPath(path, workingDirectory);
      if (result.action === 'block') return result;
    }

    // Grep/Glob can target credential files via a glob/pattern selector while
    // `path` points at an innocuous directory. (Grep `pattern` is a content
    // regex, not a file selector, so it is intentionally NOT checked here.)
    const globSelector = toolName === 'Grep'
      ? input.glob
      : toolName === 'Glob'
        ? input.pattern
        : undefined;
    if (typeof globSelector === 'string' && globSelector.length > 0) {
      const result = checkGlobSelector(globSelector);
      if (result.action === 'block') return result;
    }
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

    // Best-effort fallback: catch sensitive paths assembled inside inline
    // interpreter code, which the token scan above cannot see.
    const interpreterResult = scanInterpreterCommandForSensitiveMarkers(input.command);
    if (interpreterResult) {
      return interpreterResult;
    }
  }

  return { action: 'allow' };
}

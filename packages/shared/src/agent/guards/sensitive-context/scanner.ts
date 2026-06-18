import type {
  SensitiveConfidence,
  SensitiveFinding,
  SensitiveFindingType,
  SensitiveMatch,
  SensitiveScannerResult,
  SensitiveSeverity,
} from './types.ts';

interface SensitivePattern {
  type: SensitiveFindingType;
  severity: SensitiveSeverity;
  confidence: SensitiveConfidence;
  replacement: string;
  regex: RegExp;
  replaceGroup?: number;
}

const PATTERNS: SensitivePattern[] = [
  {
    type: 'private_key',
    severity: 'critical',
    confidence: 'high',
    replacement: '[REDACTED:PRIVATE_KEY]',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    type: 'anthropic_key',
    severity: 'high',
    confidence: 'high',
    replacement: '[REDACTED:ANTHROPIC_KEY]',
    regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    type: 'openai_key',
    severity: 'high',
    confidence: 'high',
    replacement: '[REDACTED:OPENAI_KEY]',
    regex: /\bsk-(?!ant-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    type: 'github_token',
    severity: 'high',
    confidence: 'high',
    replacement: '[REDACTED:GITHUB_TOKEN]',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/g,
  },
  {
    type: 'slack_token',
    severity: 'high',
    confidence: 'high',
    replacement: '[REDACTED:SLACK_TOKEN]',
    regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    type: 'stripe_key',
    severity: 'high',
    confidence: 'high',
    replacement: '[REDACTED:STRIPE_KEY]',
    regex: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  },
  {
    type: 'aws_access_key',
    severity: 'high',
    confidence: 'high',
    replacement: '[REDACTED:AWS_ACCESS_KEY]',
    regex: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA)[A-Z0-9]{16}\b/g,
  },
  {
    type: 'oauth_token',
    severity: 'high',
    confidence: 'high',
    replacement: '[REDACTED:BEARER_TOKEN]',
    regex: /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{20,})\b/gi,
    replaceGroup: 2,
  },
  {
    type: 'jwt',
    severity: 'high',
    confidence: 'high',
    replacement: '[REDACTED:JWT]',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    type: 'api_key',
    severity: 'high',
    confidence: 'medium',
    replacement: '[REDACTED:API_KEY]',
    regex: /\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*['"]?)([A-Za-z0-9._~+/=-]{16,})/gi,
    replaceGroup: 2,
  },
  {
    type: 'password',
    severity: 'medium',
    confidence: 'medium',
    replacement: '[REDACTED:PASSWORD]',
    regex: /\b((?:password|passwd|pwd)\s*[:=]\s*['"]?)([^'"\s]{8,})/gi,
    replaceGroup: 2,
  },
  {
    type: 'credit_card',
    severity: 'medium',
    confidence: 'medium',
    replacement: '[REDACTED:CREDIT_CARD]',
    regex: /\b(?:\d[ -]*?){13,19}\b/g,
  },
  {
    type: 'email',
    severity: 'low',
    confidence: 'high',
    replacement: '[REDACTED:EMAIL]',
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  },
  {
    type: 'phone',
    severity: 'low',
    confidence: 'medium',
    replacement: '[REDACTED:PHONE]',
    regex: /(?<![A-Za-z0-9])(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}(?![A-Za-z0-9])/g,
  },
  {
    type: 'phone',
    severity: 'low',
    confidence: 'medium',
    replacement: '[REDACTED:PHONE]',
    regex: /(?<![A-Za-z0-9])(?:\+?86[-.\s]*)?1[-.\s]*[3-9](?:[-.\s]*\d){9}(?![A-Za-z0-9])/g,
  },
];

function createLineNumberLookup(text: string): (index: number) => number {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }

  return (index: number): number => {
    let low = 0;
    let high = lineStarts.length - 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (lineStarts[mid]! <= index) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return high + 1;
  };
}

function aggregateMatches(matches: SensitiveMatch[]): SensitiveFinding[] {
  const grouped = new Map<string, SensitiveFinding>();

  for (const match of matches) {
    const key = `${match.type}:${match.severity}:${match.confidence}`;
    const existing = grouped.get(key);
    const location = { line: match.line, start: match.start, end: match.end };

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

function scanHexDumpEncodedChinesePhones(text: string, lineNumberAt: (index: number) => number): SensitiveMatch[] {
  const matches: SensitiveMatch[] = [];
  const decoded: string[] = [];
  const byteLineRanges: Array<{ start: number; end: number }> = [];
  let offset = 0;

  while (offset <= text.length) {
    const newlineIndex = text.indexOf('\n', offset);
    const lineEnd = newlineIndex === -1 ? text.length : newlineIndex;
    const line = text.slice(offset, lineEnd);
    const colonIndex = line.indexOf(':');
    const prefixMatch = line.match(/^\s*[0-9a-fA-F]{6,16}\s+/);
    let afterOffset: number | null = null;

    if (colonIndex >= 0 && /^\s*[0-9a-fA-F]{6,16}$/.test(line.slice(0, colonIndex))) {
      afterOffset = colonIndex + 1;
    } else if (prefixMatch) {
      afterOffset = prefixMatch[0].length;
    }

    if (afterOffset === null) {
      if (newlineIndex === -1) break;
      offset = newlineIndex + 1;
      continue;
    }

    const lineStart = offset;
    const afterOffsetValue = afterOffset;
    const afterOffsetText = line.slice(afterOffsetValue);
    const tokenRegex = /[0-9a-fA-F]{2,4}/g;
    let tokenMatch: RegExpExecArray | null;
    let consumedHexToken = false;
    let consumedByteCount = 0;

    while ((tokenMatch = tokenRegex.exec(afterOffsetText)) !== null) {
      const token = tokenMatch[0];
      const tokenStart = tokenMatch.index;
      const previous = afterOffsetText[tokenStart - 1];
      const next = afterOffsetText[tokenStart + token.length];

      if ((previous && !/\s/.test(previous)) || (next && !/\s/.test(next))) {
        break;
      }

      consumedHexToken = true;
      for (let i = 0; i < token.length; i += 2) {
        const byte = Number.parseInt(token.slice(i, i + 2), 16);
        if (!Number.isFinite(byte)) continue;
        decoded.push(String.fromCharCode(byte));
        byteLineRanges.push({ start: lineStart, end: lineEnd });
        consumedByteCount += 1;
      }
    }

    if (!consumedHexToken || consumedByteCount < 4) {
      if (newlineIndex === -1) break;
      offset = newlineIndex + 1;
      continue;
    }

    if (newlineIndex === -1) break;
    offset = newlineIndex + 1;
  }

  const decodedText = decoded.join('');
  if (!decodedText) return matches;

  const phoneRegex = /(?<![A-Za-z0-9])(?:\+?86[-.\s]*)?1[-.\s]*[3-9](?:[-.\s]*\d){9}(?![A-Za-z0-9])/g;
  let phoneMatch: RegExpExecArray | null;

  while ((phoneMatch = phoneRegex.exec(decodedText)) !== null) {
    const startByte = phoneMatch.index;
    const endByte = startByte + phoneMatch[0].length - 1;
    const startRange = byteLineRanges[startByte];
    const endRange = byteLineRanges[endByte];
    if (!startRange || !endRange) continue;

    matches.push({
      type: 'phone',
      severity: 'low',
      confidence: 'medium',
      start: startRange.start,
      end: endRange.end,
      line: lineNumberAt(startRange.start),
      replacement: '[REDACTED:PHONE]',
    });
  }

  return matches;
}

export function scanSensitiveText(text: string): SensitiveScannerResult {
  const matches: SensitiveMatch[] = [];
  const lineNumberAt = createLineNumberLookup(text);

  for (const pattern of PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const matchedText = match[0] ?? '';
      if (!matchedText) continue;

      let start = match.index;
      let end = match.index + matchedText.length;

      if (pattern.replaceGroup !== undefined && match[pattern.replaceGroup]) {
        const groupText = match[pattern.replaceGroup]!;
        const groupOffset = matchedText.indexOf(groupText);
        if (groupOffset >= 0) {
          start = match.index + groupOffset;
          end = start + groupText.length;
        }
      }

      matches.push({
        type: pattern.type,
        severity: pattern.severity,
        confidence: pattern.confidence,
        start,
        end,
        line: lineNumberAt(start),
        replacement: pattern.replacement,
      });
    }
  }

  matches.push(...scanHexDumpEncodedChinesePhones(text, lineNumberAt));

  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  return {
    findings: aggregateMatches(matches),
    matches,
  };
}

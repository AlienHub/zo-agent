import type { SensitiveMatch } from './types.ts';

export function redactSensitiveText(text: string, matches: SensitiveMatch[]): string {
  if (matches.length === 0) return text;

  const ordered = [...matches].sort((a, b) => a.start - b.start || b.end - a.end);
  let output = '';
  let cursor = 0;

  for (const match of ordered) {
    if (match.start < cursor) continue;

    output += text.slice(cursor, match.start);
    output += match.replacement;
    cursor = match.end;
  }

  output += text.slice(cursor);
  return output;
}

import type { SensitiveMatch } from './types.ts';

export function redactSensitiveText(text: string, matches: SensitiveMatch[]): string {
  if (matches.length === 0) return text;

  const ordered = [...matches].sort((a, b) => a.start - b.start || b.end - a.end);
  let output = '';
  let cursor = 0;

  for (const match of ordered) {
    // Fully contained within an already-redacted span — nothing left to cover.
    if (match.end <= cursor) continue;

    // Emit the untouched gap before this match. For a partial overlap
    // (match.start < cursor) there is no gap; we still emit the replacement and
    // advance the cursor to match.end so the overlapping tail is never left raw.
    if (match.start > cursor) {
      output += text.slice(cursor, match.start);
    }
    output += match.replacement;
    cursor = match.end;
  }

  output += text.slice(cursor);
  return output;
}

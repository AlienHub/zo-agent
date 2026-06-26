import type { AnnotationV1 } from '@craft-agent/core'

export {
  type AnnotationFollowUpState,
  asRecord,
  normalizeFollowUpText,
  getAnnotationNoteText,
  getAnnotationFollowUpState,
  isAnnotationFollowUpSent,
} from '../annotations/follow-up-state'

export function extractAnnotationSelectedText(annotation: AnnotationV1, messageContent: string): string {
  const quoteSelector = annotation.target.selectors.find(
    (selector): selector is Extract<AnnotationV1['target']['selectors'][number], { type: 'text-quote' }> => selector.type === 'text-quote'
  )
  const quoteText = quoteSelector?.exact?.trim() ?? ''
  if (quoteText.length > 0) return quoteText

  const positionSelector = annotation.target.selectors.find(
    (selector): selector is Extract<AnnotationV1['target']['selectors'][number], { type: 'text-position' }> => selector.type === 'text-position'
  )
  if (positionSelector) {
    const start = Math.max(0, Math.min(positionSelector.start, messageContent.length))
    const end = Math.max(start, Math.min(positionSelector.end, messageContent.length))
    const slice = messageContent.slice(start, end).trim()
    if (slice.length > 0) return slice
  }

  return 'Selected text'
}

/**
 * Surrounding context captured with a text annotation — the `prefix`/`suffix`
 * stored on the text-quote selector. Handed to the agent (for document comments)
 * so it can see what's immediately around a short highlight without re-reading
 * the whole file. Empty strings when no context was captured.
 */
export function getAnnotationContext(annotation: AnnotationV1): { before: string; after: string } {
  const quoteSelector = annotation.target.selectors.find(
    (selector): selector is Extract<AnnotationV1['target']['selectors'][number], { type: 'text-quote' }> => selector.type === 'text-quote'
  )
  return {
    before: quoteSelector?.prefix?.trim() ?? '',
    after: quoteSelector?.suffix?.trim() ?? '',
  }
}

/**
 * 1-based line range of `exactQuote` within `content` (the RAW file text), so a
 * document comment can tell the agent exactly where to Read. Returns undefined
 * when the quote is not a verbatim substring — annotation offsets are anchored to
 * RENDERED text, so this only resolves for plain-prose documents; callers omit the
 * line when undefined rather than emitting a wrong one.
 */
export function computeQuoteLineRange(content: string, exactQuote: string): { start: number; end: number } | undefined {
  if (!content || !exactQuote) return undefined
  const idx = content.indexOf(exactQuote)
  if (idx === -1) return undefined
  return computeLineRangeFromOffsets(content, idx, idx + exactQuote.length)
}

function computeLineRangeFromOffsets(content: string, startOffset: number, endOffset: number): { start: number; end: number } | undefined {
  if (!content || startOffset < 0 || endOffset <= startOffset || endOffset > content.length) return undefined
  let start = 1
  for (let i = 0; i < startOffset; i++) if (content.charCodeAt(i) === 10) start++
  let end = start
  for (let i = startOffset; i < endOffset; i++) if (content.charCodeAt(i) === 10) end++
  return { start, end }
}

function findQuoteRangeWithContext(
  content: string,
  quote: Extract<AnnotationV1['target']['selectors'][number], { type: 'text-quote' }>
): { start: number; end: number } | undefined {
  if (!content || !quote.exact) return undefined

  const matches: Array<{ start: number; end: number }> = []
  let idx = content.indexOf(quote.exact)
  while (idx !== -1) {
    const start = idx
    const end = start + quote.exact.length
    const prefixOk = !quote.prefix || content.slice(Math.max(0, start - quote.prefix.length), start) === quote.prefix
    const suffixOk = !quote.suffix || content.slice(end, end + quote.suffix.length) === quote.suffix
    if (prefixOk && suffixOk) matches.push({ start, end })
    idx = content.indexOf(quote.exact, idx + 1)
  }

  return matches.length === 1 ? matches[0] : undefined
}

/**
 * 1-based line range of an annotation in raw text. Prefer a verified
 * text-position selector, then fall back to text-quote + prefix/suffix. If the
 * quote is ambiguous, returns undefined rather than reporting the wrong line.
 */
export function computeAnnotationLineRange(content: string, annotation: AnnotationV1): { start: number; end: number } | undefined {
  if (!content) return undefined

  const quoteSelector = annotation.target.selectors.find(
    (selector): selector is Extract<AnnotationV1['target']['selectors'][number], { type: 'text-quote' }> => selector.type === 'text-quote'
  )
  const positionSelector = annotation.target.selectors.find(
    (selector): selector is Extract<AnnotationV1['target']['selectors'][number], { type: 'text-position' }> => selector.type === 'text-position'
  )

  if (
    positionSelector &&
    Number.isInteger(positionSelector.start) &&
    Number.isInteger(positionSelector.end) &&
    positionSelector.start >= 0 &&
    positionSelector.end > positionSelector.start &&
    positionSelector.end <= content.length
  ) {
    const selected = content.slice(positionSelector.start, positionSelector.end)
    if (!quoteSelector?.exact || selected === quoteSelector.exact) {
      return computeLineRangeFromOffsets(content, positionSelector.start, positionSelector.end)
    }
  }

  if (!quoteSelector?.exact) return undefined
  const quoteRange = findQuoteRangeWithContext(content, quoteSelector)
  return quoteRange ? computeLineRangeFromOffsets(content, quoteRange.start, quoteRange.end) : undefined
}

import { describe, it, expect } from 'bun:test'
import type { AnnotationV1 } from '@craft-agent/core'
import { computeAnnotationLineRange, computeQuoteLineRange, getAnnotationContext } from '../follow-up-helpers'

describe('computeQuoteLineRange — document comment line location', () => {
  const doc = 'line one\nline two has the answer\nline three\nline four'

  it('returns the 1-based line of a verbatim quote', () => {
    expect(computeQuoteLineRange(doc, 'the answer')).toEqual({ start: 2, end: 2 })
    expect(computeQuoteLineRange(doc, 'line one')).toEqual({ start: 1, end: 1 })
    expect(computeQuoteLineRange(doc, 'line four')).toEqual({ start: 4, end: 4 })
  })

  it('spans a multi-line quote', () => {
    expect(computeQuoteLineRange(doc, 'two has the answer\nline three')).toEqual({ start: 2, end: 3 })
  })

  it('returns undefined when the quote is not a verbatim substring', () => {
    // Offsets are anchored to RENDERED text, so a non-matching quote must not
    // produce a wrong line — callers omit the location instead of guessing.
    expect(computeQuoteLineRange(doc, 'not present')).toBeUndefined()
    expect(computeQuoteLineRange('', 'x')).toBeUndefined()
    expect(computeQuoteLineRange(doc, '')).toBeUndefined()
  })
})

describe('getAnnotationContext — surrounding text from the text-quote selector', () => {
  function annotationWith(prefix?: string, suffix?: string): AnnotationV1 {
    return {
      id: 'a',
      schemaVersion: 1,
      createdAt: 0,
      body: [{ type: 'highlight' }],
      target: {
        source: { sessionId: 's', messageId: 'm' },
        selectors: [
          { type: 'text-position', start: 0, end: 3 },
          { type: 'text-quote', exact: 'abc', prefix, suffix },
        ],
      },
    }
  }

  it('returns trimmed prefix/suffix when captured', () => {
    expect(getAnnotationContext(annotationWith('  before ', ' after  '))).toEqual({ before: 'before', after: 'after' })
  })

  it('returns empty strings when no context was captured', () => {
    expect(getAnnotationContext(annotationWith())).toEqual({ before: '', after: '' })
  })

  it('returns empty strings when there is no text-quote selector', () => {
    const ann: AnnotationV1 = {
      id: 'a', schemaVersion: 1, createdAt: 0, body: [{ type: 'highlight' }],
      target: { source: { sessionId: 's', messageId: 'm' }, selectors: [{ type: 'text-position', start: 0, end: 3 }] },
    }
    expect(getAnnotationContext(ann)).toEqual({ before: '', after: '' })
  })
})

describe('computeAnnotationLineRange — robust document comment location', () => {
  function annotation(params: {
    exact: string
    start?: number
    end?: number
    prefix?: string
    suffix?: string
  }): AnnotationV1 {
    const selectors: AnnotationV1['target']['selectors'] = [
      { type: 'text-quote', exact: params.exact, prefix: params.prefix, suffix: params.suffix },
    ]
    if (params.start !== undefined && params.end !== undefined) {
      selectors.unshift({ type: 'text-position', start: params.start, end: params.end })
    }
    return {
      id: 'a',
      schemaVersion: 1,
      createdAt: 0,
      body: [{ type: 'highlight' }],
      target: { source: { sessionId: 's', messageId: 'm' }, selectors },
    }
  }

  it('uses the verified text-position when the same quote appears earlier', () => {
    const content = 'target\nmiddle\ntarget'
    const start = content.lastIndexOf('target')
    expect(computeAnnotationLineRange(content, annotation({ exact: 'target', start, end: start + 'target'.length }))).toEqual({ start: 3, end: 3 })
  })

  it('falls back to prefix/suffix when position does not match raw text', () => {
    const content = 'first target.\nsecond target!'
    expect(computeAnnotationLineRange(content, annotation({
      exact: 'target',
      start: 0,
      end: 6,
      prefix: 'second ',
      suffix: '!',
    }))).toEqual({ start: 2, end: 2 })
  })

  it('omits a line range for ambiguous repeated quotes without context', () => {
    const content = 'target\nmiddle\ntarget'
    expect(computeAnnotationLineRange(content, annotation({ exact: 'target' }))).toBeUndefined()
  })
})

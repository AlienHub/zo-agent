import { describe, expect, it } from 'bun:test'
import { normalizeLocalFileTarget } from '../file-link-target'

describe('normalizeLocalFileTarget', () => {
  it('leaves absolute unix paths unchanged', () => {
    expect(normalizeLocalFileTarget('/Users/tester/report.md')).toBe('/Users/tester/report.md')
  })

  it('converts unix file URLs to local paths', () => {
    expect(normalizeLocalFileTarget('file:///Users/tester/report.md')).toBe('/Users/tester/report.md')
  })

  it('decodes percent-encoded unix file URLs', () => {
    expect(normalizeLocalFileTarget('file:///Users/tester/report%20final.md')).toBe('/Users/tester/report final.md')
  })

  it('normalizes windows drive-letter file URLs', () => {
    expect(normalizeLocalFileTarget('file:///C:/Users/Tester/report.md')).toBe('C:/Users/Tester/report.md')
  })

  it('keeps non-file URLs unchanged', () => {
    expect(normalizeLocalFileTarget('https://example.com/report.md')).toBe('https://example.com/report.md')
  })
})

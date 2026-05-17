import { describe, expect, it } from 'bun:test'
import { getHtmlPreviewBaseHref, htmlRequiresBrowserRuntime, injectHtmlPreviewBase } from '../html-preview'

describe('html-preview helpers', () => {
  it('injects a base href for local file paths', () => {
    const html = '<html><head><title>Demo</title></head><body>Hello</body></html>'
    const result = injectHtmlPreviewBase(html, '/tmp/prototypes/demo.html')

    expect(result).toContain('<base href="file:///tmp/prototypes/">')
  })

  it('detects JS-driven previews', () => {
    expect(htmlRequiresBrowserRuntime('<html><body><script src="./app.js"></script></body></html>')).toBe(true)
    expect(htmlRequiresBrowserRuntime('<html><body><h1>Hello</h1></body></html>')).toBe(false)
  })

  it('returns a base href for file urls', () => {
    expect(getHtmlPreviewBaseHref('file:///tmp/prototypes/demo.html')).toBe('file:///tmp/prototypes/')
  })
})

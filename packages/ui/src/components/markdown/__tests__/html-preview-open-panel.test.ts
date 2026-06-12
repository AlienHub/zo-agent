import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// packages/ui has no RTL/jsdom harness. Keep a source-text guard for the
// product behavior: html-preview should expose the same "open in new panel"
// path as markdown-preview by wiring Markdown's onFileClick into the block.
describe('html-preview open-in-panel wiring', () => {
  it('MarkdownHtmlBlock exposes an open-in-panel action for the active src', () => {
    const src = readFileSync(join(__dirname, '../MarkdownHtmlBlock.tsx'), 'utf8')

    expect(src).toContain('onFileClick?: (path: string) => void')
    expect(src).toContain('const canOpenActiveItem = Boolean(activeItem?.src && onFileClick)')
    expect(src).toContain("title={t('sessionMenu.openInNewPanel')}")
    expect(src).toContain('if (activeItem?.src) onFileClick?.(activeItem.src)')
  })

  it('Markdown passes onFileClick through to html-preview blocks in all rich modes', () => {
    const src = readFileSync(join(__dirname, '../Markdown.tsx'), 'utf8')
    const expected = '<MarkdownHtmlBlock code={code} className="my-2" onFileClick={onFileClick} />'

    expect(src.match(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))?.length).toBe(2)
  })
})

describe('markdown-preview overflow fade', () => {
  it('only shows the bottom fade when the preview content actually overflows', () => {
    const src = readFileSync(join(__dirname, '../MarkdownDocBlock.tsx'), 'utf8')

    expect(src).toContain('const [isContentOverflowing, setIsContentOverflowing] = React.useState(false)')
    expect(src).toContain('PREVIEW_FADE_MIN_OVERFLOW_PX = 40')
    expect(src).toContain('element.scrollHeight > element.clientHeight + PREVIEW_FADE_MIN_OVERFLOW_PX')
    expect(src).toContain('activeContent !== undefined && isContentOverflowing')
  })
})

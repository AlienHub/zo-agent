import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Fullscreen Excalidraw editing is hosted by EditableExcalidrawCanvas, which
// flushes pending changes on unmount. This source-text guard exists because
// packages/ui does not have a jsdom/RTL harness, and the previous bug was that
// MarkdownExcalidrawBlock never wired that flushed onChange to file persistence.
describe('MarkdownExcalidrawBlock fullscreen autosave wiring', () => {
  it('passes fullscreen canvas changes to a file-backed save handler', () => {
    const source = readFileSync(join(__dirname, '../MarkdownExcalidrawBlock.tsx'), 'utf8')

    expect(source).toContain('const { onReadFile, onWriteFile, onResourceUpdated } = usePlatform()')
    expect(source).toContain('const handleFullscreenSceneChange = React.useCallback((nextScene: CanvasScene)')
    expect(source).toContain('serializeExcalidrawSceneForFile(nextScene)')
    expect(source).toContain('onWriteFile(src, serialized)')
    expect(source).toContain('onChange={handleFullscreenSceneChange}')
  })
})

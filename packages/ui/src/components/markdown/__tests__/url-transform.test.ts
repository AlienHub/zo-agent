import { describe, expect, it } from 'bun:test'
import { defaultUrlTransform } from 'react-markdown'
import { preserveFileUrlTransform } from '../url-transform'

const mockNode = {} as Parameters<typeof preserveFileUrlTransform>[2]

describe('preserveFileUrlTransform', () => {
  it('preserves file protocol URLs', () => {
    expect(
      preserveFileUrlTransform(
        'file:///Users/tester/report%20final.pdf',
        'href',
        mockNode
      )
    ).toBe('file:///Users/tester/report%20final.pdf')
  })

  it('delegates safe web URLs to react-markdown defaults', () => {
    expect(
      preserveFileUrlTransform('https://example.com/docs', 'href', mockNode)
    ).toBe(defaultUrlTransform('https://example.com/docs', 'href', mockNode))
  })

  it('keeps unsafe protocols sanitized', () => {
    expect(
      preserveFileUrlTransform('javascript:alert(1)', 'href', mockNode)
    ).toBe(defaultUrlTransform('javascript:alert(1)', 'href', mockNode))
  })
})

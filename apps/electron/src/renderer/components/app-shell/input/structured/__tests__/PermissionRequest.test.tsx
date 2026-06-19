import React from 'react'
import { describe, expect, it, mock } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { PermissionRequest as PermissionRequestType } from '../../../../../../shared/types'

mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      if (key === 'chat.sensitiveFileAccessIntro') return `intro:${options?.path}`
      if (key === 'chat.sensitiveFileAccessMatchedRule') return `rule:${options?.rule}`
      return key
    },
  }),
}))

const { PermissionRequest } = await import('../PermissionRequest')

function renderPermissionRequest(request: PermissionRequestType): string {
  return renderToStaticMarkup(
    <PermissionRequest
      request={request}
      onResponse={() => {}}
    />,
  )
}

describe('PermissionRequest sensitive file access UI', () => {
  it('shows once, session, and permanent allow choices for sensitive file access', () => {
    const html = renderPermissionRequest({
      requestId: 'perm-2',
      sessionId: 'session-1',
      toolName: 'Read',
      type: 'file_write',
      sensitiveCategory: 'file_access',
      description: 'Sensitive file access',
      command: '/repo/.env',
      reason: [
        'Sensitive path blocked',
        'Tool target: /repo/.env',
        'Matched sensitive credential file rule: .env',
        'The file contents were not read or sent to the model.',
      ].join('\n'),
      impact: 'This may add credential or private data to the model context.',
    })

    expect(html).toContain('chat.sensitiveFileAccessTitle')
    expect(html).toContain('intro:/repo/.env')
    expect(html).toContain('rule:.env')
    expect(html).toContain('chat.sensitiveFileAccessImpact')
    expect(html).not.toContain('Sensitive path blocked')
    expect(html).not.toContain('This may add credential')
    expect(html).toContain('chat.permissionAllowOnce')
    expect(html).toContain('chat.permissionAllowSession')
    expect(html).toContain('chat.permissionAllowPermanent')
    expect(html).toContain('chat.permissionDeny')
    expect(html).not.toContain('chat.permissionAlwaysAllow')
  })
})

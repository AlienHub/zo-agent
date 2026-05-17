import { describe, expect, it } from 'bun:test'
import { buildCompoundRoute, parseCompoundRoute, parseRouteToNavigationState } from '../route-parser'
import { getNavigationStateKey, parseNavigationStateKey, type NavigationState } from '../types'

describe('route-parser: session resource routes', () => {
  const encodedPath = encodeURIComponent('/tmp/reports/final summary.md')
  const encodedUrl = encodeURIComponent('https://example.com/docs?q=craft agents')

  it('parses file resource routes under the sessions navigator', () => {
    const result = parseCompoundRoute(`allSessions/session/session-1/resource/file/${encodedPath}`)

    expect(result).not.toBeNull()
    expect(result!.navigator).toBe('sessions')
    expect(result!.sessionFilter).toEqual({ kind: 'allSessions' })
    expect(result!.details).toEqual({
      type: 'resource',
      id: 'session-1',
      resourceKind: 'file',
      resourceTarget: '/tmp/reports/final summary.md',
    })
  })

  it('parses url resource routes with the original filter preserved', () => {
    const result = parseRouteToNavigationState(`flagged/session/session-1/resource/url/${encodedUrl}`)

    expect(result).toEqual({
      navigator: 'sessions',
      filter: { kind: 'flagged' },
      details: {
        type: 'resource',
        sessionId: 'session-1',
        resource: {
          kind: 'url',
          target: 'https://example.com/docs?q=craft agents',
        },
      },
    })
  })

  it('roundtrips session resource routes through buildCompoundRoute', () => {
    const parsed = parseCompoundRoute(`state/in-progress/session/session-2/resource/file/${encodedPath}`)
    expect(parsed).not.toBeNull()
    expect(buildCompoundRoute(parsed!)).toBe(`state/in-progress/session/session-2/resource/file/${encodedPath}`)
  })

  it('roundtrips session resource navigation keys', () => {
    const state: NavigationState = {
      navigator: 'sessions',
      filter: { kind: 'view', viewId: 'my-view' },
      details: {
        type: 'resource',
        sessionId: 'session-3',
        resource: {
          kind: 'url',
          target: 'https://example.com/docs?q=craft agents',
        },
      },
    }

    const key = getNavigationStateKey(state)
    expect(key).toBe(`view:my-view/chat/session-3/resource/url/${encodedUrl}`)
    expect(parseNavigationStateKey(key)).toEqual(state)
  })
})

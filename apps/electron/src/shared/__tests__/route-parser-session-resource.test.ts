import { describe, expect, it } from 'bun:test'
import { buildCompoundRoute, parseCompoundRoute, parseRouteToNavigationState } from '../route-parser'
import { getNavigationStateKey, parseNavigationStateKey, type NavigationState } from '../types'

describe('route-parser: session resource routes', () => {
  const encodedPath = encodeURIComponent('/tmp/reports/final summary.md')
  const encodedUrl = encodeURIComponent('https://example.com/docs?q=craft agents')

  it('parses file artifact routes under the sessions navigator', () => {
    const result = parseCompoundRoute(`allSessions/session/session-1/artifact/file/${encodedPath}`)

    expect(result).not.toBeNull()
    expect(result!.navigator).toBe('sessions')
    expect(result!.sessionFilter).toEqual({ kind: 'allSessions' })
    expect(result!.details).toEqual({
      type: 'artifact',
      id: 'session-1',
      resourceKind: 'file',
      resourceTarget: '/tmp/reports/final summary.md',
      artifactMode: 'preview',
    })
  })

  it('parses url artifact routes with the original filter preserved', () => {
    const result = parseRouteToNavigationState(`flagged/session/session-1/artifact/url/${encodedUrl}`)

    expect(result).toEqual({
      navigator: 'sessions',
      filter: { kind: 'flagged' },
      details: {
        type: 'artifact',
        sessionId: 'session-1',
        artifact: {
          kind: 'url',
          target: 'https://example.com/docs?q=craft agents',
        },
        mode: 'preview',
      },
    })
  })

  it('roundtrips session artifact routes through buildCompoundRoute', () => {
    const parsed = parseCompoundRoute(`state/in-progress/session/session-2/artifact/file/${encodedPath}`)
    expect(parsed).not.toBeNull()
    expect(buildCompoundRoute(parsed!)).toBe(`state/in-progress/session/session-2/artifact/file/${encodedPath}`)
  })

  it('roundtrips live artifact routes through buildCompoundRoute', () => {
    const parsed = parseCompoundRoute(`state/in-progress/session/session-2/artifact/file/${encodedPath}/live`)
    expect(parsed).not.toBeNull()
    expect(buildCompoundRoute(parsed!)).toBe(`state/in-progress/session/session-2/artifact/file/${encodedPath}/live`)
  })

  it('roundtrips session artifact navigation keys', () => {
    const state: NavigationState = {
      navigator: 'sessions',
      filter: { kind: 'view', viewId: 'my-view' },
      details: {
        type: 'artifact',
        sessionId: 'session-3',
        artifact: {
          kind: 'url',
          target: 'https://example.com/docs?q=craft agents',
        },
        mode: 'live',
      },
    }

    const key = getNavigationStateKey(state)
    expect(key).toBe(`view:my-view/chat/session-3/artifact/url/${encodedUrl}/live`)
    expect(parseNavigationStateKey(key)).toEqual(state)
  })

  it('still accepts legacy resource routes as input', () => {
    const result = parseRouteToNavigationState(`allSessions/session/session-4/resource/file/${encodedPath}`)

    expect(result).toEqual({
      navigator: 'sessions',
      filter: { kind: 'allSessions' },
      details: {
        type: 'artifact',
        sessionId: 'session-4',
        artifact: {
          kind: 'file',
          target: '/tmp/reports/final summary.md',
        },
        mode: 'preview',
      },
    })
  })
})

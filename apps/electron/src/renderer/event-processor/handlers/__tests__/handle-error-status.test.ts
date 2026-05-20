import { describe, expect, it } from 'bun:test'
import { handleError, handleTypedError } from '../session'
import type { SessionState } from '../../types'

function makeState(): SessionState {
  return {
    session: {
      id: 'session-1',
      messages: [],
      lastMessageAt: Date.now(),
      isProcessing: true,
      lastMessageRole: 'assistant',
    } as any,
    streaming: null,
  }
}

describe('error handlers update session list status', () => {
  it('marks plain error events as the last visible message role', () => {
    const next = handleError(makeState(), {
      type: 'error',
      sessionId: 'session-1',
      error: 'Provider crashed',
      timestamp: 123,
    })

    expect(next.state.session.isProcessing).toBe(false)
    expect(next.state.session.lastMessageRole).toBe('error')
    expect(next.state.session.messages.at(-1)?.role).toBe('error')
  })

  it('marks typed error events as the last visible message role', () => {
    const next = handleTypedError(makeState(), {
      type: 'typed_error',
      sessionId: 'session-1',
      error: {
        code: 'provider_error',
        title: 'API Error',
        message: 'Rate limited',
        actions: [],
        canRetry: true,
      },
      timestamp: 456,
    })

    expect(next.state.session.isProcessing).toBe(false)
    expect(next.state.session.lastMessageRole).toBe('error')
    expect(next.state.session.messages.at(-1)?.role).toBe('error')
  })
})

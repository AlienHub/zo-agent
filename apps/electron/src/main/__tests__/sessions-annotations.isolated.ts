import { describe, expect, it, mock } from 'bun:test'
import type { AnnotationV1 } from '@craft-agent/core/types'

mock.module('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
  },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
  },
}))

mock.module('@sentry/electron/main', () => ({
  captureException: () => {},
}))

mock.module('../logger', () => ({
  sessionLog: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  isDebugMode: false,
  getLogFilePath: () => '/tmp/main.log',
}))

mock.module('../notifications', () => ({
  updateBadgeCount: () => {},
}))

const { SessionManager } = await import('@craft-agent/server-core/sessions')

function makeAnnotation(id: string, extraMeta?: Record<string, unknown>, targetMessageId = 'msg-1'): AnnotationV1 {
  return {
    id,
    schemaVersion: 1,
    createdAt: Date.now(),
    intent: 'highlight',
    body: [{ type: 'highlight' }],
    target: {
      source: { sessionId: 'session-1', messageId: targetMessageId },
      selectors: [
        { type: 'text-position', start: 0, end: 5 },
        { type: 'text-quote', exact: 'hello' },
      ],
    },
    ...(extraMeta ? { meta: extraMeta } : {}),
  }
}

function createHarness(
  initialAnnotations: AnnotationV1[] = [],
  message?: { id: string; optimisticMessageId?: string }
) {
  const managed = {
    workspace: { id: 'ws-1' },
    messages: [{
      id: message?.id ?? 'msg-1',
      ...(message?.optimisticMessageId ? { optimisticMessageId: message.optimisticMessageId } : {}),
      content: 'hello world',
      annotations: initialAnnotations,
    }],
  }

  let persistCalls = 0
  const events: Array<{ event: any; workspaceId: string }> = []

  const manager = Object.create(SessionManager.prototype) as any
  manager.sessions = new Map([['session-1', managed]])
  manager.persistSession = () => { persistCalls += 1 }
  manager.sendEvent = (event: any, workspaceId: string) => {
    events.push({ event, workspaceId })
  }

  return {
    manager,
    managed,
    get persistCalls() {
      return persistCalls
    },
    events,
  }
}

describe('SessionManager annotation validation', () => {
  it('rejects add when per-message annotation limit is reached', () => {
    const existing = Array.from({ length: 200 }, (_, i) => makeAnnotation(`ann-${i}`))
    const h = createHarness(existing)

    h.manager.addMessageAnnotation('session-1', 'msg-1', makeAnnotation('ann-over-limit'))

    expect(h.managed.messages[0].annotations).toHaveLength(200)
    expect(h.persistCalls).toBe(0)
    expect(h.events).toHaveLength(0)
  })

  it('rejects add for oversized annotation payload', () => {
    const h = createHarness([])
    const oversizedMeta = { blob: 'x'.repeat(40 * 1024) }

    h.manager.addMessageAnnotation('session-1', 'msg-1', makeAnnotation('ann-big', oversizedMeta))

    expect(h.managed.messages[0].annotations).toHaveLength(0)
    expect(h.persistCalls).toBe(0)
    expect(h.events).toHaveLength(0)
  })

  it('resolves add by the renderer optimistic id when the live bubble kept it', () => {
    // The server message has its own canonical id, but a live user bubble is
    // annotated using the optimistic id the renderer never swapped. The lookup
    // must match the optimistic id, otherwise the note is silently dropped
    // (the bug: vanishing 追问 note when saved during an in-flight turn).
    const h = createHarness([], { id: 'server-msg-1', optimisticMessageId: 'opt-msg-1' })

    h.manager.addMessageAnnotation('session-1', 'opt-msg-1', makeAnnotation('ann-1', undefined, 'opt-msg-1'))

    expect(h.managed.messages[0].annotations).toHaveLength(1)
    expect(h.managed.messages[0].annotations[0]?.id).toBe('ann-1')
    expect(h.persistCalls).toBe(1)
    // Event echoes the id the client sent (optimistic) so the renderer's bubble matches.
    expect(h.events).toHaveLength(1)
    expect(h.events[0]?.event.type).toBe('message_annotations_updated')
    expect(h.events[0]?.event.messageId).toBe('opt-msg-1')
  })

  it('rejects update patch with empty selectors array', () => {
    const existing = [makeAnnotation('ann-1')]
    const h = createHarness(existing)

    h.manager.updateMessageAnnotation('session-1', 'msg-1', 'ann-1', {
      target: {
        source: { sessionId: 'session-1', messageId: 'msg-1' },
        selectors: [],
      },
    })

    expect(h.managed.messages[0].annotations).toHaveLength(1)
    expect(h.managed.messages[0].annotations[0]?.id).toBe('ann-1')
    expect(h.persistCalls).toBe(0)
    expect(h.events).toHaveLength(0)
  })
})

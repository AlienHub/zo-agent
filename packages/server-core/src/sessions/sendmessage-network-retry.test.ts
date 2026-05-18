import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SessionManager, createManagedSession } from './SessionManager.ts'

describe('sendMessage Pi/Codex transport retry', () => {
  let tmpRoot: string
  let sm: SessionManager

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sm-network-retry-'))
    sm = new SessionManager()
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  function buildManagedSession(id: string) {
    const workspace = {
      id: 'ws_test',
      name: 'Test Workspace',
      rootPath: tmpRoot,
      createdAt: Date.now(),
    }
    const managed = createManagedSession(
      {
        id,
        name: 'network retry test',
        lastSentMessage: 'hello',
        activeProviderType: 'pi',
        activePiAuthProvider: 'openai-codex',
      },
      workspace as never,
      {
        messagesLoaded: true,
        isProcessing: true,
        messages: [{
          id: 'user-1',
          role: 'user',
          content: 'hello',
          timestamp: Date.now(),
        }],
      },
    )
    ;(sm as unknown as { sessions: Map<string, unknown> }).sessions.set(id, managed)
    return { managed, workspace }
  }

  it('retries typed network_error once for Pi + OpenAI Codex transport drops', async () => {
    const { managed, workspace } = buildManagedSession('codex-drop')
    const sentEvents: Array<{ type: string; message?: string }> = []
    const sendCalls: unknown[][] = []

    ;(sm as any).sendEvent = (event: { type: string; message?: string }) => {
      sentEvents.push(event)
    }
    ;(sm as any).sendMessage = async (...args: unknown[]) => {
      sendCalls.push(args)
    }

    await (sm as any).processEvent(managed, {
      type: 'typed_error',
      error: {
        code: 'network_error',
        title: 'Connection Error',
        message: 'Could not reach the AI service. Check your internet connection or VPN settings.',
        originalError: 'WebSocket closed 1011 keepalive ping timeout',
        actions: [{ key: 'r', label: 'Retry', action: 'retry' }],
        canRetry: true,
      },
    })

    await new Promise(resolve => setImmediate(resolve))

    expect(sendCalls).toHaveLength(1)
    expect(sendCalls[0]?.[0]).toBe('codex-drop')
    expect(sendCalls[0]?.[1]).toBe('hello')
    expect(sendCalls[0]?.[6]).toBe('network')
    expect(managed.messages.some(m => m.role === 'error')).toBe(false)
    expect(managed.messages.some(m => m.role === 'user')).toBe(false)
    expect(sentEvents.some(e => e.type === 'info' && e.message?.includes('reconnecting'))).toBe(true)
  })

  it('does not auto-retry the same network_error on non-Codex connections', async () => {
    const { managed } = buildManagedSession('other-provider')
    managed.activePiAuthProvider = 'openai'

    const sendCalls: unknown[][] = []
    ;(sm as any).sendEvent = () => {}
    ;(sm as any).sendMessage = async (...args: unknown[]) => {
      sendCalls.push(args)
    }

    await (sm as any).processEvent(managed, {
      type: 'typed_error',
      error: {
        code: 'network_error',
        title: 'Connection Error',
        message: 'Could not reach the AI service. Check your internet connection or VPN settings.',
        originalError: 'WebSocket closed 1011 keepalive ping timeout',
        actions: [{ key: 'r', label: 'Retry', action: 'retry' }],
        canRetry: true,
      },
    })

    await new Promise(resolve => setImmediate(resolve))

    expect(sendCalls).toHaveLength(0)
    expect(managed.messages.some(m => m.role === 'error')).toBe(true)
  })
})

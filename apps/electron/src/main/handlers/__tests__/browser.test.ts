import { describe, expect, it, mock } from 'bun:test'
import type { HandlerFn, RequestContext, RpcServer } from '@craft-agent/server-core/transport'
import { RPC_CHANNELS } from '../../../shared/types'
import { registerBrowserHandlers } from '../browser'
import type { HandlerDeps } from '../handler-deps'

function createMockServer() {
  const handlers = new Map<string, HandlerFn>()
  const server: RpcServer = {
    handle(channel: string, handler: HandlerFn) {
      handlers.set(channel, handler)
    },
    push() {},
    async invokeClient() {},
  }
  return { server, handlers }
}

describe('registerBrowserHandlers', () => {
  it('creates panel-owned session browser instances when an explicit id is provided', () => {
    const createInstance = mock((id: string) => id)
    const bindSession = mock(() => {})
    const focus = mock(() => {})
    const createForSession = mock(() => 'session-browser')
    const { server, handlers } = createMockServer()

    registerBrowserHandlers(server, {
      browserPaneManager: {
        createInstance,
        bindSession,
        focus,
        createForSession,
        onStateChange: () => {},
        onRemoved: () => {},
        onInteracted: () => {},
      },
      platform: {
        logger: console,
      },
    } as unknown as HandlerDeps)

    const create = handlers.get(RPC_CHANNELS.browserPane.CREATE)
    expect(create).toBeDefined()

    const id = create?.({ clientId: 'test', workspaceId: null, webContentsId: null } satisfies RequestContext, {
      id: 'artifact-panel-1',
      show: true,
      bindToSessionId: 'session-1',
    })

    expect(id).toBe('artifact-panel-1')
    expect(createInstance).toHaveBeenCalledWith('artifact-panel-1', {
      show: true,
      ownerType: 'session',
      ownerSessionId: 'session-1',
    })
    expect(bindSession).toHaveBeenCalledWith('artifact-panel-1', 'session-1')
    expect(focus).toHaveBeenCalledWith('artifact-panel-1')
    expect(createForSession).not.toHaveBeenCalled()
  })
})

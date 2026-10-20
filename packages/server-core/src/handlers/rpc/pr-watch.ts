/**
 * PR watcher RPCs (Coding mode's chat-header PR chip). The registry runs here, on the workspace
 * server: it has the session's folder, the source credentials and `gh`, so tokens never reach a
 * client. Clients subscribe per session and receive `prWatch:changed` pushes.
 */

import { RPC_CHANNELS, type PrDetails, type PrWatchState } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { githubGraphql } from '../../services/pr-watch/github-client'
import { PrWatchRegistry } from '../../services/pr-watch/registry'
import { tokenCandidates, type GitHubSourceLike } from '../../services/pr-watch/token-chain'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.prWatch.SUBSCRIBE,
  RPC_CHANNELS.prWatch.UNSUBSCRIBE,
  RPC_CHANNELS.prWatch.REFRESH,
  RPC_CHANNELS.prWatch.GET_DETAILS,
] as const

let registry: PrWatchRegistry | null = null

/** Drops a disconnected client's subscriptions (wired into the server's client cleanup). */
export function cleanupPrWatchForClient(clientId: string): void {
  registry?.dropClient(clientId)
}

/**
 * The workspace's GitHub sources (API or MCP, enabled) as token candidates. OAuth tokens go through
 * the refresh manager; a source without a stored credential is skipped without touching it.
 */
async function loadGitHubSources(workspaceRootPath: string): Promise<GitHubSourceLike[]> {
  const { loadWorkspaceSources, getSourceCredentialManager, TokenRefreshManager } = await import('@craft-agent/shared/sources')
  const credentials = getSourceCredentialManager()
  const refresh = new TokenRefreshManager(credentials)
  return loadWorkspaceSources(workspaceRootPath)
    .filter(source => source.config.provider === 'github' && source.config.enabled !== false && (source.config.type === 'api' || source.config.type === 'mcp'))
    .map(source => ({
      slug: source.config.slug,
      name: source.config.name,
      getToken: async () => {
        const stored = await credentials.load(source)
        if (!stored?.value) return null
        const token = stored.refreshToken ? (await refresh.ensureFreshToken(source)).token ?? null : stored.value
        // Header-map credentials (JSON) are not bearer tokens
        return token && !token.trimStart().startsWith('{') ? token : null
      },
    }))
}

export function registerPrWatchHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger
  registry?.dispose()
  const current = new PrWatchRegistry({
    graphql: (host, token, query, variables) => githubGraphql(host, token, query, variables),
    candidates: async (host, workspaceRootPath) => tokenCandidates(host, await loadGitHubSources(workspaceRootPath).catch(() => [])),
    push: (clientId, sessionId, state) => pushTyped(server, RPC_CHANNELS.prWatch.CHANGED, { to: 'client', clientId }, sessionId, state),
    log: message => log.info(message),
  })
  registry = current

  // A finished turn is when pushes and `gh pr create` happen: refetch then
  deps.sessionManager.onTurnComplete?.(sessionId => {
    void current.nudge(sessionId)
  })

  server.handle(RPC_CHANNELS.prWatch.SUBSCRIBE, async (ctx, sessionId: string): Promise<{ subscriptionId: string | null; state: PrWatchState }> => {
    const session = await deps.sessionManager.getSession(sessionId)
    if (!session?.codingMode) return { subscriptionId: null, state: { kind: 'unavailable', reason: 'not-git' } }
    const dir = deps.sessionManager.getSessionWorkingDirectory(sessionId) ?? session.workingDirectory
    const workspace = getWorkspaceByNameOrId(session.workspaceId)
    if (!dir || !workspace) return { subscriptionId: null, state: { kind: 'unavailable', reason: 'not-git' } }
    return current.subscribe({ clientId: ctx.clientId, sessionId, dir, workspaceRootPath: workspace.rootPath })
  })

  server.handle(RPC_CHANNELS.prWatch.UNSUBSCRIBE, async (_ctx, subscriptionId: string) => {
    current.unsubscribe(subscriptionId)
  })

  server.handle(RPC_CHANNELS.prWatch.REFRESH, async (ctx, sessionId: string) => {
    await current.nudge(sessionId, ctx.clientId)
  })

  server.handle(RPC_CHANNELS.prWatch.GET_DETAILS, async (ctx, sessionId: string): Promise<PrDetails | null> => {
    return current.getDetails(sessionId, ctx.clientId)
  })
}

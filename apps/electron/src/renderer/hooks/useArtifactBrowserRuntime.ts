import * as React from 'react'
import { useAtomValue } from 'jotai'
import { browserInstancesAtom } from '@/atoms/browser-pane'
import type { BrowserInstanceInfo, SessionArtifactTarget } from '../../shared/types'

interface UseArtifactBrowserRuntimeOptions {
  active: boolean
  focused: boolean
  panelId: string
  sessionId: string
  artifact: SessionArtifactTarget
}

interface EnsureOptions {
  force?: boolean
  show?: boolean
}

export interface ArtifactBrowserRuntimeState {
  instanceId: string
  instance: BrowserInstanceInfo | null
  isEnsuring: boolean
  error: string | null
  ensure: (options?: EnsureOptions) => Promise<string | null>
  focus: () => Promise<void>
}

function hashRuntimeKey(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

function buildInstanceId(panelId: string, sessionId: string, artifact: SessionArtifactTarget): string {
  return `artifact-${panelId}-${hashRuntimeKey(`${sessionId}:${artifact.kind}:${artifact.target}`)}`
}

export function useArtifactBrowserRuntime({
  active,
  focused,
  panelId,
  sessionId,
  artifact,
}: UseArtifactBrowserRuntimeOptions): ArtifactBrowserRuntimeState {
  const browserInstances = useAtomValue(browserInstancesAtom)
  const [isEnsuring, setIsEnsuring] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const runtimeKeyRef = React.useRef<string | null>(null)
  const artifactKind = artifact.kind
  const artifactTarget = artifact.target

  const instanceId = React.useMemo(
    () => buildInstanceId(panelId, sessionId, { kind: artifactKind, target: artifactTarget }),
    [artifactKind, artifactTarget, panelId, sessionId],
  )

  const instance = React.useMemo<BrowserInstanceInfo | null>(
    () => browserInstances.find((candidate) => candidate.id === instanceId) ?? null,
    [browserInstances, instanceId],
  )

  const ensure = React.useCallback(async (options: EnsureOptions = {}) => {
    if (!active) return null

    const runtimeKey = `${instanceId}:${artifactKind}:${artifactTarget}`
    if (!options.force && runtimeKeyRef.current === runtimeKey) {
      if (options.show !== false) {
        await window.electronAPI.browserPane.focus(instanceId)
      }
      return instanceId
    }

    runtimeKeyRef.current = runtimeKey
    setIsEnsuring(true)
    setError(null)

    try {
      const id = await window.electronAPI.browserPane.create({
        id: instanceId,
        show: options.show ?? true,
        bindToSessionId: sessionId,
      })
      await window.electronAPI.browserPane.navigate(id, artifactTarget)
      if (options.show !== false) {
        await window.electronAPI.browserPane.focus(id)
      }
      return id
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start browser runtime'
      if (runtimeKeyRef.current === runtimeKey) {
        runtimeKeyRef.current = null
        setError(message)
        setIsEnsuring(false)
      }
      throw err
    } finally {
      if (runtimeKeyRef.current === runtimeKey) {
        setIsEnsuring(false)
      }
    }
  }, [active, artifactKind, artifactTarget, instanceId, sessionId])

  const focus = React.useCallback(async () => {
    if (!active) return
    await window.electronAPI.browserPane.focus(instanceId)
  }, [active, instanceId])

  React.useEffect(() => {
    if (!active) {
      runtimeKeyRef.current = null
      setError(null)
      setIsEnsuring(false)
      return undefined
    }

    let disposed = false
    void ensure({ show: true }).catch((err) => {
      if (!disposed) {
        console.error('[useArtifactBrowserRuntime] Failed to ensure runtime:', err)
      }
    })

    return () => {
      disposed = true
      runtimeKeyRef.current = null
      void window.electronAPI.browserPane.destroy(instanceId).catch((err) => {
        console.warn('[useArtifactBrowserRuntime] Failed to destroy runtime:', err)
      })
    }
  }, [active, ensure, instanceId])

  React.useEffect(() => {
    if (!active || !focused) return
    void focus().catch((err) => {
      console.warn('[useArtifactBrowserRuntime] Failed to focus runtime:', err)
    })
  }, [active, focus, focused])

  return {
    instanceId,
    instance,
    isEnsuring,
    error,
    ensure,
    focus,
  }
}

import { BrowserWindow, app, ipcMain } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { ExcalidrawGraph, ExcalidrawMaterializeResult, ExcalidrawScene } from '@craft-agent/session-tools-core'
import { mainLog } from './logger'

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

// How long to wait for the hidden renderer's ready handshake before giving up.
// Without this, a missing preload bundle or a renderer load error would hang
// the materialize call (and the agent tool) forever.
const READY_TIMEOUT_MS = 15000

const CHANNELS = {
  request: 'excalidraw-materializer:request',
  response: 'excalidraw-materializer:response',
  ready: 'excalidraw-materializer:ready',
} as const

interface PendingRequest {
  resolve: (result: ExcalidrawMaterializeResult) => void
  timeout: NodeJS.Timeout
}

interface RendererResponse {
  requestId?: unknown
  ok?: unknown
  scene?: unknown
  previewPng?: unknown
  error?: {
    reason?: unknown
    message?: unknown
  }
}

export class ExcalidrawMaterializerService {
  private window: BrowserWindow | null = null
  private readyPromise: Promise<void> | null = null
  private resolveReady: (() => void) | null = null
  private rejectReady: ((error: Error) => void) | null = null
  private pending = new Map<string, PendingRequest>()
  private listenersRegistered = false

  async materializeCanvas(graph: ExcalidrawGraph): Promise<ExcalidrawMaterializeResult> {
    let window: BrowserWindow
    try {
      // ensureWindow now blocks until the renderer signals ready (or throws on
      // timeout / load failure, after tearing the window down so the next call
      // recreates a fresh one).
      window = await this.ensureWindow()
    } catch (error) {
      return {
        ok: false,
        error: {
          reason: 'window_load_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }

    if (window.isDestroyed()) {
      return {
        ok: false,
        error: {
          reason: 'window_destroyed',
          message: 'Excalidraw materializer window was destroyed before the request could run.',
        },
      }
    }

    const requestId = randomUUID()
    return new Promise<ExcalidrawMaterializeResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        resolve({
          ok: false,
          error: {
            reason: 'timeout',
            message: 'Excalidraw materialization timed out.',
          },
        })
      }, 10000)

      this.pending.set(requestId, { resolve, timeout })
      window.webContents.send(CHANNELS.request, { requestId, graph })
    })
  }

  async materializeScene(scene: ExcalidrawScene): Promise<ExcalidrawMaterializeResult> {
    let window: BrowserWindow
    try {
      window = await this.ensureWindow()
    } catch (error) {
      return {
        ok: false,
        error: {
          reason: 'window_load_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }

    if (window.isDestroyed()) {
      return {
        ok: false,
        error: {
          reason: 'window_destroyed',
          message: 'Excalidraw materializer window was destroyed before the request could run.',
        },
      }
    }

    const requestId = randomUUID()
    return new Promise<ExcalidrawMaterializeResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        resolve({
          ok: false,
          error: {
            reason: 'timeout',
            message: 'Excalidraw scene materialization timed out.',
          },
        })
      }, 10000)

      this.pending.set(requestId, { resolve, timeout })
      window.webContents.send(CHANNELS.request, { requestId, scene })
    })
  }

  destroy(): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.resolve({
        ok: false,
        error: {
          reason: 'shutdown',
          message: `Excalidraw materializer shut down before request ${requestId} completed`,
        },
      })
    }
    this.pending.clear()

    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
    }
    this.window = null
    this.readyPromise = null
    this.resolveReady = null
    this.rejectReady = null
  }

  private registerListeners(): void {
    if (this.listenersRegistered) return
    this.listenersRegistered = true

    ipcMain.on(CHANNELS.ready, (event) => {
      if (!this.window || event.sender.id !== this.window.webContents.id) return
      this.resolveReady?.()
      this.resolveReady = null
      this.rejectReady = null
    })

    ipcMain.on(CHANNELS.response, (event, payload: RendererResponse) => {
      if (!this.window || event.sender.id !== this.window.webContents.id) return
      this.handleResponse(payload)
    })
  }

  private handleResponse(payload: RendererResponse): void {
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : null
    if (!requestId) return

    const pending = this.pending.get(requestId)
    if (!pending) return

    this.pending.delete(requestId)
    clearTimeout(pending.timeout)

    if (payload.ok === true) {
      pending.resolve({
        ok: true,
        scene: payload.scene,
        ...(typeof payload.previewPng === 'string' ? { previewPng: payload.previewPng } : {}),
      })
      return
    }

    pending.resolve({
      ok: false,
      error: {
        reason: typeof payload.error?.reason === 'string' ? payload.error.reason : 'materialize_failed',
        message: typeof payload.error?.message === 'string' ? payload.error.message : 'Excalidraw materialization failed.',
      },
    })
  }

  private async ensureWindow(): Promise<BrowserWindow> {
    this.registerListeners()

    if (this.window && !this.window.isDestroyed()) {
      return this.window
    }

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })

    const window = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: {
        preload: join(__dirname, 'excalidraw-materializer-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    this.window = window

    window.on('closed', () => {
      if (this.window === window) {
        this.window = null
        this.readyPromise = null
        this.resolveReady = null
        this.rejectReady?.(new Error('Excalidraw materializer window closed before it became ready'))
        this.rejectReady = null
      }

      for (const [requestId, pending] of this.pending) {
        clearTimeout(pending.timeout)
        pending.resolve({
          ok: false,
          error: {
            reason: 'window_closed',
            message: `Excalidraw materializer window closed before request ${requestId} completed`,
          },
        })
      }
      this.pending.clear()
    })

    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      const message = `Excalidraw materializer failed to load: ${errorCode} ${errorDescription}`
      mainLog.warn(message)
      this.rejectReady?.(new Error(message))
    })

    const readyPromise = this.readyPromise

    if (VITE_DEV_SERVER_URL) {
      await window.loadURL(`${VITE_DEV_SERVER_URL}/excalidraw-materializer.html`)
    } else {
      await window.loadFile(join(__dirname, 'renderer/excalidraw-materializer.html'))
    }

    // Wait for the renderer's ready handshake with a timeout. A missing preload
    // bundle (window.__excalidrawMaterializerBridge undefined) or a renderer
    // load error would otherwise leave this pending forever. On failure, tear
    // the window down so the next call recreates a fresh one.
    try {
      await Promise.race([
        readyPromise ?? Promise.resolve(),
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error('Excalidraw materializer renderer did not become ready in time (missing preload bundle or renderer load error?)')),
            READY_TIMEOUT_MS,
          )
        }),
      ])
    } catch (error) {
      this.teardownWindow()
      throw error
    }

    return window
  }

  private teardownWindow(): void {
    const window = this.window
    this.window = null
    this.readyPromise = null
    this.resolveReady = null
    this.rejectReady = null
    if (window && !window.isDestroyed()) {
      // The 'closed' handler resolves any in-flight pending requests.
      window.destroy()
    }
  }
}

let singleton: ExcalidrawMaterializerService | null = null

export function getExcalidrawMaterializerService(): ExcalidrawMaterializerService {
  if (!singleton) {
    singleton = new ExcalidrawMaterializerService()
  }
  return singleton
}

export function shutdownExcalidrawMaterializerService(): void {
  singleton?.destroy()
  singleton = null
}

app.on('before-quit', () => {
  shutdownExcalidrawMaterializerService()
})

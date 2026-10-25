/**
 * Auto-update module using electron-updater
 *
 * Handles checking for updates, downloading, and installing via the standard
 * electron-updater library. Updates use the configured publish provider (GitHub Releases for Zo).
 *
 * Platform behavior:
 * - macOS: Squirrel for Developer ID builds; validated bundle handoff for ad hoc builds
 * - Windows: Downloads NSIS installer, runs silently on quit
 * - Linux: Downloads AppImage, replaces current file
 *
 * All platforms support download-progress events (electron-updater v6.8.0+).
 * The bundle installer retains the previous app until the new process confirms startup.
 */

import { autoUpdater } from 'electron-updater'
import { app, BrowserWindow } from 'electron'
import { platform } from 'os'
import * as path from 'path'
import { mainLog, autoUpdateLog } from './logger'
import { getAppVersion } from '@craft-agent/shared/version'
import {
  getDismissedUpdateVersion,
  clearDismissedUpdateVersion,
} from '@craft-agent/shared/config'
import { macUpdateStrategy } from './mac-update-policy'
import { prepareMacBundleUpdate, macArtifactFromDownload, type MacUpdateArtifact } from './mac-bundle-update'
import { RPC_CHANNELS, type UpdateInfo } from '../shared/types'
import type { EventSink } from '@craft-agent/server-core/transport'

// Platform detection
const PLATFORM = platform()
const IS_MAC = PLATFORM === 'darwin'
const macStrategy = macUpdateStrategy({
  platform: PLATFORM, isPackaged: app.isPackaged, appPath: path.resolve(process.execPath, '../../..'),
})

let downloadedMacArtifact: MacUpdateArtifact | undefined
const rollbackFailure = IS_MAC ? process.env.CRAFT_MAC_UPDATE_FAILURE : undefined
delete process.env.CRAFT_MAC_UPDATE_FAILURE

// Module state — keeps track of update info for IPC queries
let updateInfo: UpdateInfo = {
  available: false,
  currentVersion: getAppVersion(),
  latestVersion: null,
  downloadState: rollbackFailure ? 'error' : 'idle',
  downloadProgress: 0,
  error: rollbackFailure ? `Update failed; the previous application was restored. ${rollbackFailure}` : undefined,
}

let eventSink: EventSink | null = null

// Flag to indicate update is in progress — used to prevent force exit during quitAndInstall
let __isUpdating = false

// Hook fired immediately before quitAndInstall, while BrowserWindows still exist.
// electron-updater destroys windows between quitAndInstall and before-quit firing,
// so the regular before-quit save site would see an empty array.
let beforeUpdateQuitHook: (() => void) | null = null

// Hook fired (awaited) immediately before quitAndInstall, AFTER the window
// snapshot. index.ts uses it to flush sessions + release resources BEFORE the
// installer quit, so before-quit no longer needs to preventDefault (which
// cancelled Squirrel.Mac's quit and left the update downloaded-but-not-installed).
let beforeUpdateInstallHook: (() => Promise<void>) | null = null

// Hook fired when quitAndInstall throws AFTER beforeUpdateInstallHook already tore
// the app down (sessions flushed, services disposed, lock released, isQuitting set).
// The process cannot safely keep running at that point — index.ts uses this to
// inform the user and relaunch into a fresh process instead of leaving a zombie
// app whose next quit would skip the flush entirely (#891).
let installQuitFailedHook: (() => void) | null = null

/**
 * Register a callback to run inside installUpdate() before quitAndInstall.
 * Used by index.ts to snapshot multi-window state while windows are still alive.
 */
export function setBeforeUpdateQuitHook(fn: () => void): void {
  beforeUpdateQuitHook = fn
}

/**
 * Register an async callback run (awaited) inside installUpdate() right before
 * quitAndInstall. index.ts uses it to run the full quit cleanup so the installer
 * handoff isn't interrupted by the before-quit handler's preventDefault (#891).
 */
export function setBeforeUpdateInstallHook(fn: () => Promise<void>): void {
  beforeUpdateInstallHook = fn
}

/**
 * Register the recovery callback for a quitAndInstall failure that happens after
 * the install cleanup hook already ran. index.ts relaunches the app from it.
 */
export function setInstallQuitFailedHook(fn: () => void): void {
  installQuitFailedHook = fn
}

/**
 * Check if an update installation is in progress.
 * Used by main process to avoid force-quitting during update.
 */
export function isUpdating(): boolean {
  return __isUpdating
}

/**
 * Set the event sink for broadcasting update events to renderer windows
 */
export function setAutoUpdateEventSink(sink: EventSink): void {
  eventSink = sink
}

/**
 * Get current update info (called by IPC handler)
 */
export function getUpdateInfo(): UpdateInfo {
  return { ...updateInfo }
}

/**
 * Broadcast update info to all renderer windows.
 * Creates a snapshot to avoid race conditions during broadcast.
 */
function broadcastUpdateInfo(): void {
  if (!eventSink) return

  const snapshot = { ...updateInfo }
  eventSink(RPC_CHANNELS.update.AVAILABLE, { to: 'all' }, snapshot)
}

/**
 * Broadcast download progress to all renderer windows.
 */
function broadcastDownloadProgress(progress: number): void {
  if (!eventSink) return

  eventSink(RPC_CHANNELS.update.DOWNLOAD_PROGRESS, { to: 'all' }, progress)
}

// ─── Configure electron-updater ───────────────────────────────────────────────

// Auto-download updates in the background after detection
autoUpdater.autoDownload = macStrategy !== 'disabled'

// Ad hoc builds cannot use Squirrel's signing requirement. Only install via the
// explicit bundle handoff; a normal quit must never start a second installer.
autoUpdater.autoInstallOnAppQuit = !IS_MAC || macStrategy === 'native'

// Use the logger for electron-updater internal logging
autoUpdater.logger = {
  info: (msg: unknown) => mainLog.info('[electron-updater]', msg),
  warn: (msg: unknown) => mainLog.warn('[electron-updater]', msg),
  error: (msg: unknown) => mainLog.error('[electron-updater]', msg),
  debug: (msg: unknown) => mainLog.info('[electron-updater:debug]', msg),
}

// ─── Event handlers ───────────────────────────────────────────────────────────

autoUpdater.on('checking-for-update', () => {
  mainLog.info('[auto-update] Checking for updates...')
})

autoUpdater.on('update-available', (info) => {
  autoUpdateLog.info(`Update available: ${updateInfo.currentVersion} → ${info.version}`)

  updateInfo = {
    ...updateInfo,
    available: true,
    latestVersion: info.version,
    downloadState: autoUpdater.autoDownload ? 'downloading' : 'idle',
    downloadProgress: 0,
    error: undefined,
  }
  broadcastUpdateInfo()
  void import('./menu').then(({ rebuildMenu }) => rebuildMenu())
})

autoUpdater.on('update-not-available', (info) => {
  mainLog.info(`[auto-update] Already up to date (${info.version})`)

  updateInfo = {
    ...updateInfo,
    available: false,
    latestVersion: info.version,
    downloadState: 'idle',
    error: undefined,
  }
  broadcastUpdateInfo()
})

autoUpdater.on('download-progress', (progress) => {
  const percent = Math.round(progress.percent)
  updateInfo = { ...updateInfo, downloadProgress: percent }
  broadcastDownloadProgress(percent)
})

async function markDownloadReady(): Promise<void> {
  updateInfo = { ...updateInfo, downloadState: 'ready', downloadProgress: 100, error: undefined }
  broadcastUpdateInfo()
  const { rebuildMenu } = await import('./menu')
  rebuildMenu()
}

autoUpdater.on('update-downloaded', async (info) => {
  autoUpdateLog.info(`Update downloaded: v${info.version}`)
  if (IS_MAC && macStrategy === 'disabled') return
  updateInfo = { ...updateInfo, available: true, latestVersion: info.version, downloadProgress: 100 }
  // electron-updater emits this before Squirrel has validated/staged the app.
  // Only the native event below is proof that macOS can install it.
  if (IS_MAC && macStrategy === 'bundle') {
    try {
      downloadedMacArtifact = macArtifactFromDownload(info)
      await markDownloadReady()
    } catch (error) {
      updateInfo = { ...updateInfo, downloadState: 'error', error: error instanceof Error ? error.message : 'Invalid update artifact' }
      broadcastUpdateInfo()
    }
  } else if (!IS_MAC) await markDownloadReady()
  else broadcastUpdateInfo()
})

if (IS_MAC && macStrategy === 'native') {
  const nativeUpdater = require('electron').autoUpdater as typeof import('electron').autoUpdater
  nativeUpdater.on('update-downloaded', () => { void markDownloadReady() })
}

autoUpdater.on('error', (error) => {
  autoUpdateLog.error('electron-updater error', error)

  updateInfo = {
    ...updateInfo,
    downloadState: 'error',
    error: error.message,
  }
  broadcastUpdateInfo()
})

// ─── Exported API ─────────────────────────────────────────────────────────────

interface CheckOptions {
  autoDownload?: boolean
}

/**
 * Check for available updates.
 * Returns the current UpdateInfo state after check completes.
 *
 * @param options.autoDownload - If false, only checks without downloading (for manual "Check Now")
 */
export async function checkForUpdates(options: CheckOptions = {}): Promise<UpdateInfo> {
  if (updateInfo.downloadState === 'installing') return getUpdateInfo()
  const { autoDownload = true } = options

  // Temporarily override autoDownload for this check if needed
  // (e.g., manual check from settings shouldn't auto-download on metered connections)
  const previousAutoDownload = autoUpdater.autoDownload
  autoUpdater.autoDownload = autoDownload && macStrategy !== 'disabled'

  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    autoUpdateLog.error('Update check failed', error)
    updateInfo = {
      ...updateInfo,
      downloadState: 'error',
      error: error instanceof Error ? error.message : 'Check failed',
    }
  } finally {
    // Restore previous autoDownload setting
    autoUpdater.autoDownload = previousAutoDownload
  }

  return getUpdateInfo()
}

/**
 * Install the downloaded update and restart the app.
 * Calls electron-updater's quitAndInstall which handles:
 * - macOS: Extracts zip and swaps app bundle
 * - Windows: Runs NSIS installer silently
 * - Linux: Replaces AppImage file
 * Then relaunches the app automatically.
 */
export async function installUpdate(): Promise<void> {
  if (IS_MAC && macStrategy === 'disabled') throw new Error('Automatic installation is unavailable in this build')
  if (updateInfo.downloadState !== 'ready') {
    throw new Error('No update ready to install')
  }

  // Preflight and start the detached helper before disposing any app services.
  // If preparation fails, the current client stays open and operational.
  let bundleInstaller: Awaited<ReturnType<typeof prepareMacBundleUpdate>> | undefined
  updateInfo = { ...updateInfo, downloadState: 'installing' }
  broadcastUpdateInfo()
  try {
    if (IS_MAC && macStrategy === 'bundle') {
      if (!downloadedMacArtifact) throw new Error('No verified update archive')
      bundleInstaller = await prepareMacBundleUpdate(downloadedMacArtifact)
    }
  } catch (error) {
    updateInfo = { ...updateInfo, downloadState: 'error', error: error instanceof Error ? error.message : 'Update preparation failed' }
    broadcastUpdateInfo()
    throw error
  }

  autoUpdateLog.info('Installing update and restarting...')

  updateInfo = { ...updateInfo, downloadState: 'installing' }
  broadcastUpdateInfo()

  // Clear dismissed version since user is explicitly updating
  clearDismissedUpdateVersion()

  // Set flag to prevent force exit from breaking electron-updater's shutdown sequence
  __isUpdating = true

  // Diagnostic correlation with before-quit's [update-flow] log. If these
  // window counts diverge, electron-updater is destroying windows between
  // here and before-quit firing — confirms the multi-window restore bug.
  autoUpdateLog.info('installUpdate pre-quit', {
    electronWindowCount: BrowserWindow.getAllWindows().length,
    downloadState: updateInfo.downloadState,
    latestVersion: updateInfo.latestVersion,
  })

  // Snapshot window state BEFORE quitAndInstall — electron-updater destroys
  // BrowserWindows between this call and before-quit firing, so the regular
  // before-quit save would clobber window-state.json with an empty array.
  try {
    beforeUpdateQuitHook?.()
  } catch (err) {
    await bundleInstaller?.cancel()
    __isUpdating = false
    updateInfo = { ...updateInfo, downloadState: 'error', error: err instanceof Error ? err.message : 'Window snapshot failed' }
    broadcastUpdateInfo()
    autoUpdateLog.error('beforeUpdateQuit hook failed', err)
    throw err
  }

  // Run the app's quit cleanup (session flush, timers, lock release) BEFORE the
  // installer hands off. This lets the before-quit handler skip its own
  // preventDefault-based cleanup, so Squirrel.Mac's quit runs to a real exit and
  // the update actually installs (#891).
  try {
    await beforeUpdateInstallHook?.()
  } catch (err) {
    await bundleInstaller?.cancel()
    __isUpdating = false
    updateInfo = { ...updateInfo, downloadState: 'error', error: err instanceof Error ? err.message : 'Update cleanup failed' }
    broadcastUpdateInfo()
    autoUpdateLog.error('beforeUpdateInstall cleanup hook failed', err)
    installQuitFailedHook?.()
    throw err
  }

  try {
    // isSilent=false shows the installer UI on Windows if needed (fallback)
    // isForceRunAfter=true ensures the app relaunches after install
    if (bundleInstaller) {
      await bundleInstaller.commit()
      // Sessions and windows were saved explicitly above. Bypass close/quit
      // cancellation handlers so the helper can reliably observe this PID exit.
      app.exit(0)
    } else {
      autoUpdater.quitAndInstall(false, true)
    }
  } catch (error) {
    await bundleInstaller?.cancel()
    __isUpdating = false
    autoUpdateLog.error('quitAndInstall failed', error)
    updateInfo = { ...updateInfo, downloadState: 'error' }
    broadcastUpdateInfo()
    // beforeUpdateInstallHook already tore the app down — recover via the
    // registered relaunch hook instead of leaving a zombie process (#891).
    try {
      installQuitFailedHook?.()
    } catch (hookErr) {
      autoUpdateLog.error('installQuitFailed hook failed', hookErr)
    }
    throw error
  }
}

/**
 * Result of update check on launch
 */
export interface UpdateOnLaunchResult {
  action: 'none' | 'skipped' | 'ready' | 'downloading'
  reason?: string
  version?: string | null
}

/**
 * Check for updates on app launch.
 * - Checks immediately (no delay)
 * - Respects dismissed version (skips notification but allows manual check)
 * - Auto-downloads if update available
 */
export async function checkForUpdatesOnLaunch(): Promise<UpdateOnLaunchResult> {
  if (rollbackFailure) {
    autoUpdateLog.error('Previous update rolled back:', rollbackFailure)
    return { action: 'none', reason: 'previous-update-rolled-back' }
  }
  autoUpdateLog.info('Checking for updates on launch...')

  const info = await checkForUpdates({ autoDownload: true })

  if (!info.available) {
    return { action: 'none' }
  }

  // Check if this version was dismissed by user
  const dismissedVersion = getDismissedUpdateVersion()
  if (dismissedVersion === info.latestVersion) {
    mainLog.info(`[auto-update] Update ${info.latestVersion} was dismissed, skipping notification`)
    return { action: 'skipped', reason: 'dismissed', version: info.latestVersion }
  }

  if (info.downloadState === 'ready') {
    return { action: 'ready', version: info.latestVersion }
  }

  // Download in progress — will notify when ready via update-downloaded event
  return { action: 'downloading', version: info.latestVersion }
}

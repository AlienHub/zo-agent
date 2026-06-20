/**
 * Auto-update module using electron-updater
 *
 * Handles checking for updates, downloading, and installing via the standard
 * electron-updater library. Updates are served from this fork's GitHub Releases
 * using electron-builder's GitHub provider (YAML manifests + binaries).
 *
 * Platform behavior:
 * - macOS (UNSIGNED builds): electron-updater downloads + sha512-verifies the
 *   .zip, but Squirrel.Mac's quitAndInstall refuses to apply it without an Apple
 *   Developer ID signature. So for unsigned apps we do a Tauri-style self-update:
 *   a detached helper extracts the already-verified .zip and swaps the .app
 *   bundle, then relaunches. Developer-ID-signed apps fall back to quitAndInstall.
 * - Windows: Downloads NSIS installer, runs silently on quit (quitAndInstall).
 * - Linux: Downloads AppImage, replaces current file (quitAndInstall).
 *
 * All platforms support download-progress events (electron-updater v6.8.0+).
 */

import { autoUpdater } from 'electron-updater'
import { app, BrowserWindow } from 'electron'
import { platform, tmpdir } from 'os'
import { spawn, spawnSync } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { mainLog } from './logger'
import { getAppVersion } from '@craft-agent/shared/version'
import {
  getDismissedUpdateVersion,
  clearDismissedUpdateVersion,
} from '@craft-agent/shared/config'
import { readJsonFileSync } from '@craft-agent/shared/utils/files'
import { RPC_CHANNELS, type UpdateInfo } from '../shared/types'
import type { EventSink } from '@craft-agent/server-core/transport'

// Platform detection
const PLATFORM = platform()
const IS_MAC = PLATFORM === 'darwin'
const IS_WINDOWS = PLATFORM === 'win32'

// Get the update cache directory path (for file watcher fallback on macOS)
// electron-updater uses these paths:
// - Windows: %LOCALAPPDATA%/{appName}-updater/pending
// - macOS: ~/Library/Caches/{appName}-updater/pending
// - Linux: ~/.cache/{appName}-updater/pending
function getUpdateCacheDir(): string {
  const appName = app.getName()
  if (IS_MAC) {
    return path.join(app.getPath('home'), 'Library', 'Caches', `${appName}-updater`, 'pending')
  } else if (IS_WINDOWS) {
    // Windows uses LOCALAPPDATA, not APPDATA (roaming)
    const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local')
    return path.join(localAppData, `${appName}-updater`, 'pending')
  } else {
    // Linux
    return path.join(app.getPath('home'), '.cache', `${appName}-updater`, 'pending')
  }
}

// Module state — keeps track of update info for IPC queries
let updateInfo: UpdateInfo = {
  available: false,
  currentVersion: getAppVersion(),
  latestVersion: null,
  downloadState: 'idle',
  downloadProgress: 0,
}

let eventSink: EventSink | null = null

// Path to the downloaded + sha512-verified update artifact (captured from the
// electron-updater `update-downloaded` event). Used by the macOS custom swap.
let downloadedFilePath: string | null = null

// Flag to indicate update is in progress — used to prevent force exit during quitAndInstall
let __isUpdating = false

// Hook fired immediately before quitAndInstall, while BrowserWindows still exist.
// electron-updater destroys windows between quitAndInstall and before-quit firing,
// so the regular before-quit save site would see an empty array.
let beforeUpdateQuitHook: (() => void) | null = null

/**
 * Register a callback to run inside installUpdate() before quitAndInstall.
 * Used by index.ts to snapshot multi-window state while windows are still alive.
 */
export function setBeforeUpdateQuitHook(fn: () => void): void {
  beforeUpdateQuitHook = fn
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
autoUpdater.autoDownload = true

// Install on app quit (if update is downloaded but user hasn't clicked "Restart").
// Disabled on macOS: Squirrel.Mac can't apply unsigned updates, and our custom
// mac swap (installUpdateMacUnsigned) is only invoked explicitly via installUpdate().
autoUpdater.autoInstallOnAppQuit = !IS_MAC

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
  mainLog.info(`[auto-update] Update available: ${updateInfo.currentVersion} → ${info.version}`)

  // First, check electron-updater's internal state (most reliable)
  const internalState = checkElectronUpdaterState()
  if (internalState.ready) {
    mainLog.info(`[auto-update] electron-updater reports download ready`)
    updateInfo = {
      ...updateInfo,
      available: true,
      latestVersion: info.version,
      downloadState: 'ready',
      downloadProgress: 100,
    }
    broadcastUpdateInfo()
    return
  }

  // Fallback: check if file exists in cache directory
  const existing = checkForExistingDownload()
  if (existing.exists) {
    mainLog.info(`[auto-update] Update already downloaded (file check), setting state to ready`)
    updateInfo = {
      ...updateInfo,
      available: true,
      latestVersion: info.version,
      downloadState: 'ready',
      downloadProgress: 100,
    }
    broadcastUpdateInfo()
    return
  }

  updateInfo = {
    ...updateInfo,
    available: true,
    latestVersion: info.version,
    downloadState: 'downloading',
    downloadProgress: 0,
  }
  broadcastUpdateInfo()
})

autoUpdater.on('update-not-available', (info) => {
  mainLog.info(`[auto-update] Already up to date (${info.version})`)

  updateInfo = {
    ...updateInfo,
    available: false,
    latestVersion: info.version,
    downloadState: 'idle',
  }
  broadcastUpdateInfo()
})

autoUpdater.on('download-progress', (progress) => {
  const percent = Math.round(progress.percent)
  updateInfo = { ...updateInfo, downloadProgress: percent }
  broadcastDownloadProgress(percent)
})

autoUpdater.on('update-downloaded', async (info) => {
  mainLog.info(`[auto-update] Update downloaded: v${info.version}`)

  // electron-updater exposes the verified artifact path on the event.
  const dl = (info as { downloadedFile?: string }).downloadedFile
  if (dl) {
    downloadedFilePath = dl
    mainLog.info(`[auto-update] downloadedFile: ${dl}`)
  }

  updateInfo = {
    ...updateInfo,
    available: true,
    latestVersion: info.version,
    downloadState: 'ready',
    downloadProgress: 100,
  }
  broadcastUpdateInfo()

  // Rebuild menu to show "Install Update..." option
  const { rebuildMenu } = await import('./menu')
  rebuildMenu()
})

autoUpdater.on('error', (error) => {
  mainLog.error('[auto-update] Error:', error.message)

  updateInfo = {
    ...updateInfo,
    downloadState: 'error',
    error: error.message,
  }
  broadcastUpdateInfo()
})

// ─── Exported API ─────────────────────────────────────────────────────────────

/**
 * Check if electron-updater already has a validated download ready.
 * This uses electron-updater's internal state which is more reliable than file checks.
 */
function checkElectronUpdaterState(): { ready: boolean; version?: string } {
  try {
    // Access electron-updater's internal downloadedUpdateHelper
    // @ts-expect-error - accessing internal API for reliability
    const helper = autoUpdater.downloadedUpdateHelper
    if (helper) {
      mainLog.info(`[auto-update] downloadedUpdateHelper exists, cacheDir: ${helper.cacheDir}`)
      // @ts-expect-error - accessing internal API
      const versionInfo = helper.versionInfo
      if (versionInfo) {
        mainLog.info(`[auto-update] electron-updater has validated download: ${JSON.stringify(versionInfo)}`)
        return { ready: true, version: versionInfo.version }
      }
    }
  } catch (error) {
    mainLog.warn('[auto-update] Error checking electron-updater state:', error)
  }
  return { ready: false }
}

/**
 * Options for checkForUpdates
 */
interface CheckOptions {
  /** If true, automatically start download when update is found (default: true) */
  autoDownload?: boolean
}

/**
 * Check if a downloaded update already exists in the cache directory.
 * This helps detect updates that were downloaded in a previous session.
 */
function checkForExistingDownload(): { exists: boolean; version?: string } {
  try {
    const cacheDir = getUpdateCacheDir()
    mainLog.info(`[auto-update] Checking cache directory: ${cacheDir}`)

    if (!fs.existsSync(cacheDir)) {
      mainLog.info(`[auto-update] Cache directory does not exist`)
      return { exists: false }
    }

    const files = fs.readdirSync(cacheDir)
    mainLog.info(`[auto-update] Files in cache: ${JSON.stringify(files)}`)

    // Look for update info file that electron-updater creates
    const updateInfoFile = files.find(f => f === 'update-info.json')
    if (updateInfoFile) {
      const infoPath = path.join(cacheDir, updateInfoFile)
      const info = readJsonFileSync(infoPath) as Record<string, unknown> | null
      mainLog.info(`[auto-update] update-info.json contents: ${JSON.stringify(info)}`)

      // electron-updater uses 'fileName' (not 'path') in update-info.json
      const fileName = (info?.fileName || info?.path) as string | undefined
      if (fileName && fs.existsSync(path.join(cacheDir, fileName))) {
        mainLog.info(`[auto-update] Found existing download via update-info.json: ${fileName}`)
        return { exists: true, version: (info?.version as string | undefined) ?? inferVersionFromUpdateFileName(fileName) }
      }
    }

    // Fallback: check for any installer/zip/dmg file
    const downloadFile = files.find(f =>
      f.endsWith('.zip') ||
      f.endsWith('.exe') ||
      f.endsWith('.AppImage') ||
      f.endsWith('.dmg') ||
      f.endsWith('.nupkg')
    )
    if (downloadFile) {
      mainLog.info(`[auto-update] Found existing download file: ${downloadFile}`)
      return { exists: true, version: inferVersionFromUpdateFileName(downloadFile) }
    }

    mainLog.info(`[auto-update] No existing download found in cache`)
    return { exists: false }
  } catch (error) {
    mainLog.warn('[auto-update] Error checking for existing download:', error)
    return { exists: false }
  }
}

function inferVersionFromUpdateFileName(fileName: string): string | undefined {
  const match = fileName.match(/(?:^|[-_])(\d+\.\d+\.\d+)(?:[-_.]|$)/)
  return match?.[1]
}

async function refreshReadyUpdateState(): Promise<boolean> {
  const internalState = checkElectronUpdaterState()
  if (internalState.ready) {
    updateInfo = {
      ...updateInfo,
      available: true,
      latestVersion: internalState.version ?? updateInfo.latestVersion,
      downloadState: 'ready',
      downloadProgress: 100,
    }
    broadcastUpdateInfo()
    return true
  }

  const existing = checkForExistingDownload()
  if (existing.exists) {
    updateInfo = {
      ...updateInfo,
      available: true,
      latestVersion: existing.version ?? updateInfo.latestVersion,
      downloadState: 'ready',
      downloadProgress: 100,
    }
    broadcastUpdateInfo()
    return true
  }

  return false
}

/**
 * Check for available updates.
 * Returns the current UpdateInfo state after check completes.
 *
 * @param options.autoDownload - If false, only checks without downloading (for manual "Check Now")
 */
export async function checkForUpdates(options: CheckOptions = {}): Promise<UpdateInfo> {
  const { autoDownload = true } = options

  // Temporarily override autoDownload for this check if needed
  // (e.g., manual check from settings shouldn't auto-download on metered connections)
  const previousAutoDownload = autoUpdater.autoDownload
  autoUpdater.autoDownload = autoDownload

  try {
    // Check for updates - this returns a promise that resolves with the check result
    const result = await autoUpdater.checkForUpdates()

    // If update is available and was already downloaded, the update-downloaded event
    // should fire. Wait a moment for events to settle before returning.
    if (result?.updateInfo) {
      // Give electron-updater time to fire update-downloaded if file exists
      await new Promise(resolve => setTimeout(resolve, 500))

      // Double-check: if we're still showing 'downloading' but file exists, update state
      if (updateInfo.downloadState === 'downloading') {
        const existing = checkForExistingDownload()
        if (existing.exists) {
          mainLog.info('[auto-update] Update already downloaded, updating state to ready')
          updateInfo = {
            ...updateInfo,
            downloadState: 'ready',
            downloadProgress: 100,
          }
          broadcastUpdateInfo()
        }
      }
    }
  } catch (error) {
    mainLog.error('[auto-update] Check failed:', error)
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

// ─── macOS unsigned self-update (Tauri-style bundle swap) ─────────────────────

/** Resolve the installed `.app` bundle path from the running executable. */
function getInstalledAppBundlePath(): string | null {
  const marker = '.app/Contents/'
  const idx = process.execPath.indexOf(marker)
  if (idx === -1) return null
  return process.execPath.slice(0, idx + 4) // include ".app"
}

/** Locate the downloaded + sha512-verified update .zip (event path, then cache). */
function locateDownloadedMacZip(): string | null {
  if (downloadedFilePath && downloadedFilePath.endsWith('.zip') && fs.existsSync(downloadedFilePath)) {
    return downloadedFilePath
  }
  try {
    const cacheDir = getUpdateCacheDir()
    if (!fs.existsSync(cacheDir)) return null
    const infoPath = path.join(cacheDir, 'update-info.json')
    if (fs.existsSync(infoPath)) {
      const info = readJsonFileSync(infoPath) as Record<string, unknown> | null
      const fileName = (info?.fileName || info?.path) as string | undefined
      if (fileName && fileName.endsWith('.zip')) {
        const p = path.join(cacheDir, fileName)
        if (fs.existsSync(p)) return p
      }
    }
    const zip = fs.readdirSync(cacheDir).find(f => f.endsWith('.zip'))
    return zip ? path.join(cacheDir, zip) : null
  } catch (error) {
    mainLog.warn('[auto-update] locateDownloadedMacZip failed:', error)
    return null
  }
}

/**
 * Whether the running app is signed with a Developer ID Application certificate.
 * Signed apps can use Squirrel.Mac (quitAndInstall); unsigned/ad-hoc apps cannot
 * and must use the custom bundle swap.
 */
function isAppDeveloperIdSigned(): boolean {
  try {
    const bundle = getInstalledAppBundlePath()
    if (!bundle) return false
    const res = spawnSync('/usr/bin/codesign', ['-dvv', bundle], { encoding: 'utf8' })
    return /Authority=Developer ID Application/.test(`${res.stdout ?? ''}${res.stderr ?? ''}`)
  } catch {
    return false
  }
}

/**
 * Self-update for unsigned macOS builds. electron-updater has already downloaded
 * and sha512-verified the .zip; we extract it and swap the .app bundle from a
 * detached helper (the app can't replace itself while running), then relaunch.
 * Throws if the artifact or bundle can't be located (caller restores error state).
 */
async function installUpdateMacUnsigned(): Promise<void> {
  const zipPath = locateDownloadedMacZip()
  if (!zipPath) throw new Error('Verified update .zip not found in cache')
  const appBundle = getInstalledAppBundlePath()
  if (!appBundle) throw new Error('Could not resolve the installed .app bundle path')

  const work = fs.mkdtempSync(path.join(tmpdir(), 'zo-update-'))
  const scriptPath = path.join(work, 'apply-update.sh')
  const logPath = path.join(tmpdir(), 'zo-update-helper.log')

  // All inputs are passed via env (NOT string-interpolated) so paths containing
  // spaces or special characters can't break or inject into the script.
  const script = [
    '#!/bin/bash',
    'set -uo pipefail',
    'exec >> "$ZO_LOG" 2>&1',
    'echo "[zo-update] $(date) start pid=$ZO_PID bundle=$ZO_BUNDLE zip=$ZO_ZIP"',
    '# 1. Wait for the running app to exit (up to ~60s), breaking as soon as it dies.',
    'for _ in $(seq 1 300); do kill -0 "$ZO_PID" 2>/dev/null || break; sleep 0.2; done',
    'sleep 0.5',
    '# 2. Extract the verified zip (ditto preserves macOS bundle metadata).',
    'EXTRACT="$ZO_WORK/extract"; mkdir -p "$EXTRACT"',
    'if ! ditto -x -k "$ZO_ZIP" "$EXTRACT"; then echo "[zo-update] ERROR extract"; exit 1; fi',
    'NEW_APP="$(/usr/bin/find "$EXTRACT" -maxdepth 1 -name "*.app" -print -quit)"',
    'if [ -z "$NEW_APP" ] || [ ! -d "$NEW_APP" ]; then echo "[zo-update] ERROR no .app in zip"; exit 1; fi',
    '# 3. Swap with backup/restore safety.',
    'BACKUP="$ZO_BUNDLE.old-$$"; rm -rf "$BACKUP"',
    'if ! mv "$ZO_BUNDLE" "$BACKUP"; then echo "[zo-update] ERROR move-old"; exit 1; fi',
    'if ! ditto "$NEW_APP" "$ZO_BUNDLE"; then',
    '  echo "[zo-update] ERROR install, restoring backup"',
    '  rm -rf "$ZO_BUNDLE"; mv "$BACKUP" "$ZO_BUNDLE"; open "$ZO_BUNDLE"; exit 1',
    'fi',
    'rm -rf "$BACKUP"',
    '# 4. Clear quarantine and relaunch.',
    'xattr -dr com.apple.quarantine "$ZO_BUNDLE" 2>/dev/null || true',
    'echo "[zo-update] success, relaunching"',
    'open "$ZO_BUNDLE"',
    'rm -rf "$ZO_WORK" 2>/dev/null || true',
    '',
  ].join('\n')

  fs.writeFileSync(scriptPath, script, { mode: 0o755 })
  mainLog.info(`[auto-update] mac self-update: helper ${scriptPath} (log ${logPath})`)

  const child = spawn('/bin/bash', [scriptPath], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      ZO_PID: String(process.pid),
      ZO_BUNDLE: appBundle,
      ZO_ZIP: zipPath,
      ZO_WORK: work,
      ZO_LOG: logPath,
    },
  })
  child.unref()

  // Give the detached helper a moment to start, then quit so it can swap the bundle.
  setTimeout(() => {
    mainLog.info('[auto-update] quitting for mac self-update swap')
    app.quit()
  }, 300)
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
  if (updateInfo.downloadState !== 'ready') {
    mainLog.warn(`[auto-update] installUpdate called while state is ${updateInfo.downloadState}; refreshing update state`)

    if (!await refreshReadyUpdateState()) {
      await checkForUpdates({ autoDownload: true })
      await new Promise(resolve => setTimeout(resolve, 500))
      await refreshReadyUpdateState()
    }
  }

  if (updateInfo.downloadState !== 'ready') {
    throw new Error('No update ready to install')
  }

  mainLog.info('[auto-update] Installing update and restarting...')

  updateInfo = { ...updateInfo, downloadState: 'installing' }
  broadcastUpdateInfo()

  // Clear dismissed version since user is explicitly updating
  clearDismissedUpdateVersion()

  // Set flag to prevent force exit from breaking electron-updater's shutdown sequence
  __isUpdating = true

  // Diagnostic correlation with before-quit's [update-flow] log. If these
  // window counts diverge, electron-updater is destroying windows between
  // here and before-quit firing — confirms the multi-window restore bug.
  mainLog.info('[update-flow] installUpdate pre-quit', {
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
    mainLog.error('[auto-update] beforeUpdateQuit hook failed:', err)
  }

  try {
    if (IS_MAC && !isAppDeveloperIdSigned()) {
      // Unsigned macOS build: Squirrel.Mac would refuse to apply the update, so
      // swap the bundle ourselves from the already-verified .zip.
      await installUpdateMacUnsigned()
    } else {
      // isSilent=false shows the installer UI on Windows if needed (fallback)
      // isForceRunAfter=true ensures the app relaunches after install
      autoUpdater.quitAndInstall(false, true)
    }
  } catch (error) {
    __isUpdating = false
    mainLog.error('[auto-update] install failed:', error)
    updateInfo = { ...updateInfo, downloadState: 'error' }
    broadcastUpdateInfo()
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
  mainLog.info('[auto-update] Checking for updates on launch...')

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

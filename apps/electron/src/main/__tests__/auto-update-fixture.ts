import { mock } from 'bun:test'
import { EventEmitter } from 'node:events'

/** Run each updater fixture in its own Bun process; it replaces Electron's native services. */
export function mockMacUpdater(strategy: 'native' | 'bundle' | 'disabled') {
  const native = new EventEmitter()
  const opened: string[] = []
  const effects = { quit: 0, cleared: 0, hooks: 0, prepared: 0, committed: 0, cancelled: 0, failPrepare: false, failCleanup: false, downloads: [] as boolean[] }
  const updater = Object.assign(new EventEmitter(), {
    autoDownload: true, autoInstallOnAppQuit: true, logger: {},
    // Cached metadata is deliberately present; it is not native installer readiness.
    downloadedUpdateHelper: { versionInfo: { version: '0.2.2' } },
    async checkForUpdates() {
      effects.downloads.push(updater.autoDownload)
      updater.emit('update-available', { version: '0.2.2' })
      return { updateInfo: { version: '0.2.2' } }
    },
    quitAndInstall() { effects.quit++ },
  })
  mock.module('electron-updater', () => ({ autoUpdater: updater }))
  mock.module('electron', () => ({
    app: { isPackaged: true, exit() { effects.quit++ } }, BrowserWindow: { getAllWindows: () => [] }, autoUpdater: native,
    shell: { openExternal: async (url: string) => { opened.push(url) } },
  }))
  mock.module('os', () => ({ platform: () => 'darwin' }))
  mock.module('../mac-update-policy', () => ({
    macUpdateStrategy: () => strategy,
  }))
  mock.module('../mac-bundle-update', () => ({
    macArtifactFromDownload: (info: {version: string}) => ({ archive: '/verified.zip', version: info.version, sha512: 'verified' }),
    prepareMacBundleUpdate: async () => {
      effects.prepared++
      if (effects.failPrepare) throw new Error('Update checksum mismatch')
      return { commit: async () => { effects.committed++ }, cancel: async () => { effects.cancelled++ } }
    },
  }))
  mock.module('../logger', () => ({ mainLog: { info() {}, warn() {} }, autoUpdateLog: { info() {}, error() {} } }))
  mock.module('../menu', () => ({ rebuildMenu() {} }))
  mock.module('@craft-agent/shared/version', () => ({ getAppVersion: () => '0.2.1' }))
  mock.module('@craft-agent/shared/config', () => ({
    getDismissedUpdateVersion: () => null, clearDismissedUpdateVersion: () => { effects.cleared++ },
  }))
  return { updater, native, opened, effects }
}

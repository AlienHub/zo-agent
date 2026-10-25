// Entry point for isolated, genuinely signed Electron bundles in the updater test.
import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { installUpdate, checkForUpdates, getUpdateInfo, setAutoUpdateEventSink, setBeforeUpdateInstallHook, setBeforeUpdateQuitHook } from '../auto-update'
import { acknowledgeMacUpdateLaunch } from '../mac-bundle-update'

const record = (event: string) => appendFileSync(process.env.ZO_UPDATE_TEST_TRACE!, JSON.stringify({ event, version: app.getVersion(), pid: process.pid }) + '\n')
app.setPath('userData', process.env.ZO_UPDATE_TEST_DATA!)
app.setAppLogsPath(path.join(process.env.ZO_UPDATE_TEST_DATA!, 'logs'))
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } })
  await win.loadURL('data:text/html,<h1>Isolated Zo update verification</h1>')
  record('window-loaded')
  if (app.getVersion() === '0.2.2') {
    if (require(path.join(app.getAppPath(), 'package.json')).fixtureMode === 'fail') { app.exit(2); return }
    if (require(path.join(app.getAppPath(), 'package.json')).fixtureMode === 'hang') return
    record('diagnostic:' + JSON.stringify({loading:win.webContents.isLoading(), mainLoading:win.webContents.isLoadingMainFrame(), transaction:!!process.env.CRAFT_MAC_UPDATE_TRANSACTION}))
    await acknowledgeMacUpdateLaunch()
    record('acknowledged')
    setTimeout(() => app.quit(), 30000)
    return
  }
  const previousStarts = readFileSync(process.env.ZO_UPDATE_TEST_TRACE!, 'utf8').split('\n').filter(line => line.includes('window-loaded') && line.includes('0.2.1')).length
  if (previousStarts > 1) { record('rollback-state:' + getUpdateInfo().downloadState); setTimeout(() => app.quit(), 30000); return }
  setBeforeUpdateQuitHook(() => record('snapshot'))
  setBeforeUpdateInstallHook(async () => record('flush'))
  let installing = false
  setAutoUpdateEventSink((_channel, _target, value: unknown) => {
    if ((value as { error?: string })?.error) record('updater-error:' + (value as { error: string }).error)
    if ((value as { downloadState?: string })?.downloadState !== 'ready' || installing) return
    installing = true
    record('download-ready')
    void installUpdate().catch(error => { record(`install-error:${error.message}`); app.exit(1) })
  })
  autoUpdater.setFeedURL({ provider: 'generic', url: process.env.ZO_UPDATE_TEST_FEED! })
  const checked = await checkForUpdates()
  record('diagnostic:' + JSON.stringify({packaged:app.isPackaged, ...checked}))
}).catch(error => { record(`startup-error:${error.message}`); app.exit(1) })
setTimeout(() => app.exit(3), 150000)

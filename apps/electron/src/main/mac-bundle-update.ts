import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { gt, valid } from 'semver'

export interface MacUpdateArtifact { archive: string; version: string; sha512: string }

function helper() {
  // This resource is included independently of the main bundle by electron-builder.
  return require(path.join(app.getAppPath(), 'resources/scripts/mac-update-helper.cjs')) as {
    prepareUpdate(options: MacUpdateArtifact & { target: string; parentPid: number; arch: string; log: string }): Promise<string>
    acknowledgeLaunch(target: string, version: string): Promise<void>
  }
}

export async function prepareMacBundleUpdate(artifact: MacUpdateArtifact) {
  if (!app.isPackaged || process.platform !== 'darwin') throw new Error('Updates can only replace an installed macOS app')
  if (!valid(artifact.version) || !gt(artifact.version, app.getVersion())) throw new Error('Update must be newer than the installed app')
  const target = path.resolve(process.execPath, '../../..')
  const logDirectory = app.getPath('logs')
  await mkdir(logDirectory, { recursive: true })
  const work = await helper().prepareUpdate({
    ...artifact, target, parentPid: process.pid, arch: process.arch,
    log: path.join(logDirectory, 'mac-update-install.log'),
  })
  let committed = false
  const child = spawn(process.execPath, [path.join(work, 'installer.cjs'), work], {
    detached: true, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  let failure: Error | undefined
  child.once('error', error => { failure = error })
  child.once('exit', () => { if (!committed) failure = new Error('Update helper exited before handoff') })
  child.unref()
  try {
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      if (failure) throw failure
      const waiting = await readFile(path.join(work, 'waiting.json'), 'utf8').catch(() => '')
      if (waiting && JSON.parse(waiting).pid === child.pid) {
        return {
          async commit() {
            if (failure || child.exitCode !== null || child.signalCode !== null) throw failure || new Error('Update helper exited before handoff')
            await writeFile(path.join(work, 'commit'), '', { mode: 0o600 })
            committed = true
          },
          async cancel() { if (!committed) await writeFile(path.join(work, 'cancel'), '', { mode: 0o600 }) },
        }
      }
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Update helper failed to start')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw new Error('Update helper did not acknowledge startup')
  } catch (error) {
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const closed = new Promise(resolve => child.once('close', resolve))
      child.kill()
      await closed
    }
    await rm(work, { recursive: true, force: true })
    throw error
  }
}

/** Confirm only after initialization and the initial windows have loaded. */
export async function acknowledgeMacUpdateLaunch(): Promise<void> {
  if (process.platform !== 'darwin' || !app.isPackaged || !process.env.CRAFT_MAC_UPDATE_TRANSACTION) return
  await Promise.all(BrowserWindow.getAllWindows().map(win => new Promise<void>((resolve, reject) => {
    if (!win.webContents.isLoadingMainFrame()) { resolve(); return }
    const timeout = setTimeout(() => finish(new Error('Window did not load after update')), 60000)
    const success = () => finish()
    const failure = () => finish(new Error('Window failed to load after update'))
    const finish = (error?: Error) => {
      clearTimeout(timeout)
      win.webContents.removeListener('did-finish-load', success)
      win.webContents.removeListener('did-stop-loading', success)
      win.webContents.removeListener('did-fail-load', failure)
      win.removeListener('closed', failure)
      error ? reject(error) : resolve()
    }
    win.webContents.once('did-finish-load', success)
    win.webContents.once('did-stop-loading', success)
    win.webContents.once('did-fail-load', failure)
    win.once('closed', failure)
  })))
  await helper().acknowledgeLaunch(path.resolve(process.execPath, '../../..'), app.getVersion())
}

/** Match the downloaded ZIP to its checksum, never arbitrary files in an updater cache. */
export function macArtifactFromDownload(info: {
  version: string; downloadedFile: string; files: { url: string; sha512: string }[]
}): MacUpdateArtifact {
  const name = path.basename(info.downloadedFile)
  if (!name.endsWith('.zip')) throw new Error('macOS updates require the verified ZIP artifact')
  const file = info.files.find(file => path.basename(decodeURIComponent(new URL(file.url, 'https://update.invalid/').pathname)) === name)
  if (!file || Buffer.from(file.sha512, 'base64').length !== 64) throw new Error('No matching checksum for downloaded update')
  return { archive: info.downloadedFile, sha512: file.sha512, version: info.version }
}

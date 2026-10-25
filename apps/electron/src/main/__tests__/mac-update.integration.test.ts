import { expect, test } from 'bun:test'
import { build } from 'esbuild'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, copyFile, rename } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'

const exec = promisify(execFile)
const root = path.resolve(import.meta.dir, '../../../../..')
const helperPath = path.join(root, 'apps/electron/resources/scripts/mac-update-helper.cjs')
const installer = require(helperPath)
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor<T>(fn: () => Promise<T | undefined>, timeout = 120000): Promise<T> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await fn(); if (value !== undefined) return value; await sleep(100) }
  throw new Error('Timed out waiting for isolated updater')
}
async function json(file: string) { return JSON.parse(await readFile(file, 'utf8')) }
async function version(app: string) { return (await exec('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(app, 'Contents/Info.plist')])).stdout.trim() }

// Opt in: builds and launches private application copies; never touches /Applications.
test.skipIf(process.platform !== 'darwin' || process.env.ZO_TEST_MAC_UPDATER !== '1')('actual Electron download, replacement, restart, rollback and preflight rejection', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "Zo 更新 ' test "))
  const bundleId = `com.alienhub.zo.update-test.${randomUUID().replaceAll('-', '')}`
  const trace = path.join(directory, 'trace.jsonl')
  const userData = path.join(directory, 'user-data')
  await mkdir(userData)
  const sentinel = path.join(userData, 'sessions-preserved.json')
  const data = JSON.stringify({ sessions: ['existing-session'], connection: 'preserved' })
  await writeFile(sentinel, data)
  await writeFile(trace, '')
  const code = path.join(directory, 'fixture.cjs')
  await build({
    entryPoints: [path.join(import.meta.dir, 'mac-update-electron.fixture.ts')], outfile: code,
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
    plugins: [{ name: 'fixture-services', setup(builder) {
      builder.onResolve({ filter: /^(\.\/logger|\.\/menu|@craft-agent\/shared\/(version|config))$/ }, args => ({ path: args.path, namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
        args.path.endsWith('version') ? "exports.getAppVersion=()=>require('electron').app.getVersion()" :
        args.path.endsWith('config') ? 'exports.getDismissedUpdateVersion=()=>null;exports.clearDismissedUpdateVersion=()=>{}' :
        args.path === './menu' ? 'exports.rebuildMenu=()=>{}' : 'exports.mainLog=exports.autoUpdateLog={info(){},warn(){},error(){}}', loader: 'js' }))
    } }],
  })
  async function bundle(name: string, nextVersion: string, mode = 'success') {
    const app = path.join(directory, name + '.app')
    await exec('/bin/cp', ['-cR', path.join(root, 'node_modules/electron/dist/Electron.app'), app])
    const plist = path.join(app, 'Contents/Info.plist')
    for (const [key, value] of [['CFBundleIdentifier', bundleId], ['CFBundleShortVersionString', nextVersion], ['CFBundleVersion', nextVersion], ['CFBundleExecutable', 'ZoFixture']]) {
      await exec('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist])
    }
    await rename(path.join(app, 'Contents/MacOS/Electron'), path.join(app, 'Contents/MacOS/ZoFixture'))
    const resources = path.join(app, 'Contents/Resources/app')
    await mkdir(path.join(resources, 'resources/scripts'), { recursive: true })
    await copyFile(code, path.join(resources, 'main.cjs'))
    await copyFile(helperPath, path.join(resources, 'resources/scripts/mac-update-helper.cjs'))
    await writeFile(path.join(resources, 'package.json'), JSON.stringify({ name: 'zo-update-test', version: nextVersion, main: 'main.cjs', fixtureMode: mode }))
    await writeFile(path.join(app, 'Contents/Resources/app-update.yml'), `provider: generic\nurl: http://127.0.0.1\nupdaterCacheDirName: ${bundleId}-updater\n`)
    await exec('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { timeout: 120000 })
    return app
  }
  const target = await bundle('Zo Installed', '0.2.1')
  const candidate = await bundle('Zo Candidate', '0.2.2')
  const zip = path.join(directory, `Zo-0.2.2-${process.arch}.zip`)
  await exec('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', candidate, zip], { timeout: 120000 })
  let sha512 = createHash('sha512').update(await readFile(zip)).digest('base64')
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
    const route = new URL(request.url).pathname
    console.log('Isolated feed request:', route)
    if (route === '/latest-mac.yml') return new Response(`version: 0.2.2\nfiles:\n  - url: ${path.basename(zip)}\n    sha512: ${sha512}\npath: ${path.basename(zip)}\nsha512: ${sha512}\nreleaseDate: '2026-10-25T00:00:00.000Z'\n`)
    if (route === '/' + path.basename(zip)) return new Response(Bun.file(zip))
    return new Response('', { status: 404 })
  } })
  const env: NodeJS.ProcessEnv = { ...process.env, ZO_UPDATE_TEST_TRACE: trace, ZO_UPDATE_TEST_DATA: userData, ZO_UPDATE_TEST_FEED: String(server.url) }
  delete env.ELECTRON_RUN_AS_NODE
  const processes: ReturnType<typeof spawn>[] = []
  const log = path.join(directory, 'installer.log')
  try {
    // A changed archive/hash or mismatched identity fails before any quit or swap.
    await expect(installer.prepareUpdate({ target, archive: zip, sha512: Buffer.alloc(64).toString('base64'), version: '0.2.2', arch: process.arch, parentPid: process.pid, log })).rejects.toThrow('checksum')
    await expect(installer.prepareUpdate({ target, archive: zip, sha512, version: '0.2.3', arch: process.arch, parentPid: process.pid, log })).rejects.toThrow('identity/version')
    expect(await version(target)).toBe('0.2.1')
    expect(await readFile(trace, 'utf8')).toBe('')

    const child = spawn(path.join(target, 'Contents/MacOS/ZoFixture'), [], { env, stdio: 'ignore' })
    processes.push(child)
    const success = await waitFor(async () => {
      const work = (await readdir(directory)).find(name => name.startsWith('.zo-update-'))
      if (!work) return
      const result = await json(path.join(directory, work, 'result.json')).catch(() => null)
      if (result) return { result, work: path.join(directory, work) }
    })
    expect(success.result.status).toBe('installed')
    expect(await version(target)).toBe('0.2.2')
    const events = (await readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(events.filter(e => !e.event.startsWith('diagnostic:')).map(e => e.event)).toEqual(['window-loaded', 'download-ready', 'snapshot', 'flush', 'window-loaded', 'acknowledged'])
    expect(events.at(-1).pid).not.toBe(child.pid)
    expect(await readFile(sentinel, 'utf8')).toBe(data)
    process.kill(events.at(-1).pid, 'SIGTERM')
    await sleep(1000)
    await rm(success.work, { recursive: true, force: true })

    // Restore a fresh previous version. Make the next app exit before acknowledging.
    await rm(target, { recursive: true, force: true })
    await bundle('Zo Installed', '0.2.1')
    const candidatePackage = path.join(candidate, 'Contents/Resources/app/package.json')
    await writeFile(candidatePackage, JSON.stringify({ name: 'zo-update-test', version: '0.2.2', main: 'main.cjs', fixtureMode: 'fail' }))
    await exec('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', candidate], { timeout: 120000 })
    await rm(zip)
    await exec('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', candidate, zip], { timeout: 120000 })
    sha512 = createHash('sha512').update(await readFile(zip)).digest('base64')
    const work = await installer.prepareUpdate({ target, archive: zip, sha512, version: '0.2.2', arch: process.arch, parentPid: 2147483647, log, launchTimeout: 10000 })
    await writeFile(path.join(work, 'commit'), '')
    // Run the same detached helper against a real failing Electron candidate.
    const worker = spawn(process.execPath, [path.join(work, 'installer.cjs'), work], { env, stdio: 'ignore' })
    processes.push(worker)
    const rollback = await waitFor(async () => json(path.join(work, 'result.json')).catch(() => undefined))
    expect(rollback.status).toBe('rolled-back')
    expect(await version(target)).toBe('0.2.1')
    expect(await readFile(sentinel, 'utf8')).toBe(data)
    await waitFor(async () => {
      const lines = (await readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      return lines.filter(e => e.event === 'window-loaded' && e.version === '0.2.1').length >= 2 ? true : undefined
    })
    // Stop the rollback instance before it can automatically start another fixture update.
    const lastOld = (await readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(e => e.version === '0.2.1').at(-1)
    try { process.kill(lastOld.pid, 'SIGTERM') } catch {}
    await sleep(500)
    const recorded = await readFile(trace, 'utf8')
    expect(recorded).toContain('rollback-state:error')

    // Helper timeout must leave a live original app untouched.
    await rm(work, { recursive: true, force: true })
    const cancelled = await installer.prepareUpdate({ target, archive: zip, sha512, version: '0.2.2', arch: process.arch, parentPid: process.pid, log, exitTimeout: 250 })
    const timeoutWorker = spawn(process.execPath, [path.join(cancelled, 'installer.cjs'), cancelled], { env, stdio: 'ignore' })
    processes.push(timeoutWorker)
    const timeoutResult = await waitFor(async () => json(path.join(cancelled, 'result.json')).catch(() => undefined))
    expect(timeoutResult.status).toBe('cancelled')
    expect(await version(target)).toBe('0.2.1')

    // A candidate which stays alive but never confirms startup must also roll back.
    await writeFile(candidatePackage, JSON.stringify({ name: 'zo-update-test', version: '0.2.2', main: 'main.cjs', fixtureMode: 'hang' }))
    await exec('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', candidate], { timeout: 120000 })
    await rm(zip)
    await exec('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', candidate, zip], { timeout: 120000 })
    sha512 = createHash('sha512').update(await readFile(zip)).digest('base64')
    const hanging = await installer.prepareUpdate({ target, archive: zip, sha512, version: '0.2.2', arch: process.arch, parentPid: 2147483647, log, launchTimeout: 5000 })
    await writeFile(path.join(hanging, 'commit'), '')
    const hangingWorker = spawn(process.execPath, [path.join(hanging, 'installer.cjs'), hanging], { env, stdio: 'ignore' })
    processes.push(hangingWorker)
    const hangResult = await waitFor(async () => json(path.join(hanging, 'result.json')).catch(() => undefined))
    expect(hangResult.status).toBe('rolled-back')
    expect(await version(target)).toBe('0.2.1')
    expect(await readFile(sentinel, 'utf8')).toBe(data)
    await waitFor(async () => {
      const lines = (await readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
      return lines.filter(e => e.event === 'window-loaded' && e.version === '0.2.1').length >= 3 ? true : undefined
    })
    console.log('Verified actual Electron update/restart, rollback/relaunch, session-data preservation, bad checksum/version, and live-process timeout')
  } finally {
    server.stop(true)
    for (const child of processes) { try { child.kill('SIGTERM') } catch {} }
    // Stop only the fixture PIDs recorded in this private directory.
    const events = (await readFile(trace, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    console.log('Isolated lifecycle:', events.map(e => e.event + ':' + e.version).join(' → '))
    for (const pid of new Set(events.map(e => e.pid))) { try { process.kill(pid, 'SIGTERM') } catch {} }
    await sleep(500)
    await rm(directory, { recursive: true, force: true })
    await rm(path.join(os.homedir(), 'Library/Caches', bundleId + '-updater'), { recursive: true, force: true })
  }
}, 300000)

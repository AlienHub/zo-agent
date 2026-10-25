/** Detached bundle installer. Built-in Node modules and macOS tools only. */
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const exec = promisify(execFile)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const exists = async file => !!await fs.lstat(file).catch(() => null)
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'))

async function atomicJson(file, value) {
  await fs.writeFile(file + '.tmp', JSON.stringify(value), { mode: 0o600 })
  await fs.rename(file + '.tmp', file)
}

async function digest(file) {
  const hash = crypto.createHash('sha512')
  const handle = await fs.open(file, 'r')
  try { for await (const chunk of handle.createReadStream()) hash.update(chunk) }
  finally { await handle.close() }
  return hash.digest('base64')
}

async function plist(app, key) {
  return (await exec('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(app, 'Contents/Info.plist')])).stdout.trim()
}

// Check paths and symlink parents BEFORE extraction, preventing writes outside staging.
async function inspectArchive(archive) {
  const handle = await fs.open(archive, 'r')
  try {
    const size = (await handle.stat()).size
    const tail = Buffer.alloc(Math.min(size, 65557))
    await handle.read(tail, 0, tail.length, size - tail.length)
    let end = tail.length - 22
    while (end >= 0 && (tail.readUInt32LE(end) !== 0x06054b50 || end + 22 + tail.readUInt16LE(end + 20) !== tail.length)) end--
    if (end < 0 || tail.readUInt16LE(end + 4) !== 0 || tail.readUInt16LE(end + 6) !== 0) throw new Error('Invalid update ZIP')
    const count = tail.readUInt16LE(end + 10)
    const bytes = tail.readUInt32LE(end + 12)
    const offset = tail.readUInt32LE(end + 16)
    if (count === 65535 || bytes > 32 * 1024 * 1024 || offset + bytes > size - 22) throw new Error('Unsupported update ZIP directory')
    const directory = Buffer.alloc(bytes)
    await handle.read(directory, 0, bytes, offset)
    const entries = []
    let cursor = 0
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > bytes || directory.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP entry')
      const length = directory.readUInt16LE(cursor + 28)
      const extra = directory.readUInt16LE(cursor + 30)
      const comment = directory.readUInt16LE(cursor + 32)
      const name = directory.subarray(cursor + 46, cursor + 46 + length).toString('utf8')
      const mode = directory.readUInt32LE(cursor + 38) >>> 16
      if (!name || name.includes('\\') || /[\x00-\x1f]/.test(name) || path.posix.isAbsolute(name)
        || name.split('/').includes('..') || name.split('/').includes('.')) throw new Error('Unsafe update ZIP path')
      entries.push({ name: name.replace(/\/$/, ''), symlink: (mode & 0xf000) === 0xa000 })
      cursor += 46 + length + extra + comment
    }
    if (cursor !== bytes) throw new Error('Invalid ZIP directory size')
    const links = new Set(entries.filter(e => e.symlink).map(e => e.name))
    for (const entry of entries) {
      for (let parent = path.posix.dirname(entry.name); parent !== '.'; parent = path.posix.dirname(parent)) {
        if (links.has(parent)) throw new Error('Update ZIP writes through a symlink')
      }
    }
  } finally { await handle.close() }
}

async function validateBundle(app, expected) {
  if (!(await fs.lstat(app)).isDirectory()) throw new Error('Update application must be a real directory')
  const id = await plist(app, 'CFBundleIdentifier')
  const version = await plist(app, 'CFBundleShortVersionString')
  const executable = await plist(app, 'CFBundleExecutable')
  if (id !== expected.bundleId || version !== expected.version || path.basename(executable) !== executable) throw new Error('Update bundle identity/version mismatch')
  const realApp = await fs.realpath(app)
  async function inspect(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const target = await fs.realpath(file)
        if (!target.startsWith(realApp + path.sep)) throw new Error('Update bundle symlink escapes application')
      } else if (entry.isDirectory()) await inspect(file)
      else if (!entry.isFile()) throw new Error('Unsupported update bundle file')
    }
  }
  await inspect(app)
  const binary = path.join(app, 'Contents/MacOS', executable)
  await fs.access(binary, require('node:fs').constants.X_OK)
  const archs = (await exec('/usr/bin/lipo', ['-archs', binary])).stdout.trim().split(/\s+/)
  if (!archs.includes(expected.arch === 'arm64' ? 'arm64' : 'x86_64')) throw new Error('Update does not support this CPU')
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { timeout: 120000 })
  return executable
}

/** Complete expensive checks while the current app is still operational. */
async function prepareUpdate(options) {
  const target = await fs.realpath(options.target)
  if (!target.endsWith('.app') || path.basename(target) === 'Electron.app') throw new Error('Not an installed application bundle')
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(options.version)) throw new Error('Invalid update version')
  const hashBytes = Buffer.from(options.sha512 || '', 'base64')
  if (hashBytes.length !== 64 || hashBytes.toString('base64') !== options.sha512) throw new Error('Missing update checksum')
  const work = await fs.mkdtemp(path.join(path.dirname(target), '.zo-update-'))
  await fs.chmod(work, 0o700)
  try {
    const bundleId = await plist(target, 'CFBundleIdentifier')
    const oldVersion = await plist(target, 'CFBundleShortVersionString')
    if (oldVersion === options.version) throw new Error('Update is already installed')
    const archive = path.join(work, 'update.zip')
    await fs.copyFile(options.archive, archive, require('node:fs').constants.COPYFILE_EXCL)
    if (await digest(archive) !== options.sha512) throw new Error('Update checksum mismatch')
    await inspectArchive(archive)
    const extracted = path.join(work, 'extracted')
    await fs.mkdir(extracted)
    await exec('/usr/bin/ditto', ['-x', '-k', archive, extracted], { timeout: 180000 })
    const roots = (await fs.readdir(extracted)).filter(name => name !== '__MACOSX')
    if (roots.length !== 1 || !roots[0].endsWith('.app')) throw new Error('Expected one application in update ZIP')
    const candidate = path.join(extracted, roots[0])
    const executable = await validateBundle(candidate, { bundleId, version: options.version, arch: options.arch })
    await fs.copyFile(__filename, path.join(work, 'installer.cjs'))
    const plan = {
      target, candidate, executable, bundleId, version: options.version,
      parentPid: options.parentPid, nonce: crypto.randomBytes(24).toString('hex'),
      backup: path.join(work, 'previous.app'), log: options.log,
      exitTimeout: options.exitTimeout || 60000, launchTimeout: options.launchTimeout || 120000,
    }
    await atomicJson(path.join(work, 'plan.json'), plan)
    return work
  } catch (error) {
    await fs.rm(work, { recursive: true, force: true })
    throw error
  }
}

function launch(plan, work, updated, failure) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.CRAFT_MAC_UPDATE_TRANSACTION
  delete env.CRAFT_MAC_UPDATE_FAILURE
  if (updated) env.CRAFT_MAC_UPDATE_TRANSACTION = work
  if (failure) env.CRAFT_MAC_UPDATE_FAILURE = failure
  const child = spawn(path.join(plan.target, 'Contents/MacOS', plan.executable), [], {
    env, cwd: require('node:os').homedir(), detached: true, stdio: 'ignore',
  })
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve(child) })
  })
}

async function runWorker(work) {
  const plan = await json(path.join(work, 'plan.json'))
  const log = async message => fs.appendFile(plan.log, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 }).catch(() => {})
  let backedUp = false, installed = false, launched
  const running = () => launched && launched.exitCode === null && launched.signalCode === null && alive(launched.pid)
  try {
    await atomicJson(path.join(work, 'waiting.json'), { pid: process.pid })
    const deadline = Date.now() + plan.exitTimeout
    while (alive(plan.parentPid)) {
      if (await exists(path.join(work, 'cancel'))) throw new Error('Installation cancelled before quit')
      if (Date.now() > deadline) throw new Error('Existing app did not exit; application left unchanged')
      await sleep(100)
    }
    if (!await exists(path.join(work, 'commit'))) throw new Error('App exited before update handoff')
    await log(`Installing ${plan.version}`)
    await fs.rename(plan.target, plan.backup)
    backedUp = true
    await fs.rename(plan.candidate, plan.target)
    installed = true
    launched = await launch(plan, work, true)
    const launchDeadline = Date.now() + plan.launchTimeout
    while (Date.now() < launchDeadline && running()) {
      const ack = await json(path.join(work, 'ready.json')).catch(() => null)
      if (ack?.nonce === plan.nonce && ack?.pid === launched.pid && ack?.version === plan.version) {
        await log(`Started ${plan.version}; pid=${launched.pid}`)
        await atomicJson(path.join(work, 'result.json'), { status: 'installed', version: plan.version })
          .catch(error => log(`Unable to save install receipt: ${error.message}`))
        // Cleanup failure after confirmed startup must never trigger a rollback.
        await Promise.all([
          fs.rm(plan.backup, { recursive: true, force: true }),
          fs.rm(path.join(work, 'update.zip'), { force: true }),
          fs.rm(path.join(work, 'extracted'), { recursive: true, force: true }),
        ]).catch(error => log(`Cleanup deferred: ${error.message}`))
        return
      }
      await sleep(100)
    }
    throw new Error('Updated app did not confirm successful startup')
  } catch (error) {
    await log(`Update failed: ${error.message}`)
    try { if (backedUp) {
      if (running()) {
        launched.kill('SIGTERM')
        const deadline = Date.now() + 5000
        while (running() && Date.now() < deadline) await sleep(100)
        if (running()) { launched.kill('SIGKILL'); await sleep(200) }
      }
      if (installed) await fs.rename(plan.target, path.join(work, 'failed.app'))
      await fs.rename(plan.backup, plan.target)
      plan.executable = await plist(plan.target, 'CFBundleExecutable')
      await launch(plan, work, false, error.message)
      await log('Previous application restored and relaunched')
    } } catch (rollbackError) {
      await log(`Rollback failed; previous bundle retained at ${plan.backup}: ${rollbackError.message}`)
      await atomicJson(path.join(work, 'result.json'), { status: 'recovery-required', error: rollbackError.message }).catch(() => {})
      throw rollbackError
    }
    await atomicJson(path.join(work, 'result.json'), { status: backedUp ? 'rolled-back' : 'cancelled', error: error.message })
    throw error
  }
}

async function acknowledgeLaunch(target, version) {
  const work = process.env.CRAFT_MAC_UPDATE_TRANSACTION
  delete process.env.CRAFT_MAC_UPDATE_TRANSACTION
  if (!work || !path.basename(work).startsWith('.zo-update-') || path.dirname(work) !== path.dirname(target)) return
  const plan = await json(path.join(work, 'plan.json'))
  if (plan.target !== target || plan.version !== version) throw new Error('Invalid update startup transaction')
  await atomicJson(path.join(work, 'ready.json'), { nonce: plan.nonce, pid: process.pid, version })
}

module.exports = { prepareUpdate, runWorker, acknowledgeLaunch, inspectArchive }
if (require.main === module) runWorker(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1 })

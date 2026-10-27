import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'

// No model inference, credentials, user settings, or outbound connections.
const lock = JSON.parse(readFileSync(new URL('./runtime-lock.json', import.meta.url), 'utf8'))
assert.equal(process.versions.node, lock.nodeVersion)
const abi = JSON.parse(readFileSync('/etc/agent-compose/guest-abi.json', 'utf8'))
assert.equal(abi.guestAbi, 1)
assert.deepEqual(Object.keys(abi.providers), ['pi'])
assert.equal(abi.providers.pi.version, lock.packages['@earendil-works/pi-coding-agent'])
for (const bin of ['codex', 'claude', 'opencode', 'dsh', 'gemini']) {
  assert.equal(existsSync(`/usr/bin/${bin}`) || existsSync(`/usr/local/bin/${bin}`), false, 'Pi image must not carry other agent executables')
}
for (const [name, version] of Object.entries(lock.packages)) {
  const pkg = JSON.parse(readFileSync(`/usr/lib/node_modules/${name}/package.json`, 'utf8'))
  assert.equal(pkg.version, version, `${name}: update the base image and lock together`)
}

const adapter = '/usr/local/share/agent-compose/pi-mcp-adapter'
assert.equal(realpathSync(adapter), realpathSync('/usr/lib/node_modules/pi-mcp-adapter'))
assert.ok(statSync(`${adapter}/commands.ts`).isFile(), 'MCP sibling modules must resolve')

const environment = {
  ...process.env,
  PI_OFFLINE: '1',
  PI_TELEMETRY: '0',
}
function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8', env: environment, timeout: 20_000,
    maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  })
}
for (const [command, args] of [
  ['node', ['--version']], ['python3', ['--version']],
  ['git', ['--version']], ['bash', ['--version']],
  ['curl', ['--version']], ['python3', ['-m', 'pip', '--version']],
  ['agent-compose-runtime', ['--help']],
]) run(command, args)

const help = run('pi', ['--no-extensions', '--extension', `${adapter}/index.ts`, '--help'])
assert.doesNotMatch(help, /Failed to load extension|Unknown option/)
assert.match(help, /--mcp-config\s/, 'Pi must register the MCP configuration flag')
console.log(JSON.stringify({ status: 'ok', ...lock, platform: `${process.platform}/${process.arch}` }))

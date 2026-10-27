import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Pi uses the upstream runtime's JS facade but never launches these other
// providers' optional native executables. Keep their SDK JS imports intact.
// Prune only in the disposable extraction stage, before COPY into the final OS.
const modules = '/usr/lib/node_modules/@chaitin-ai/agent-compose-runtime/node_modules'
const removed = []
for (const [scope, pattern] of [
  ['@anthropic-ai', /^claude-agent-sdk-(linux|darwin|win32)-/],
  ['@openai', /^codex-(linux|darwin|win32)-/],
]) {
  const directory = join(modules, scope)
  if (!existsSync(directory)) continue
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !pattern.test(entry.name)) continue
    const path = join(directory, entry.name)
    const pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
    // Codex distributes platform packages as npm aliases whose internal name
    // remains @openai/codex. Require their native-only package metadata too.
    const codexAlias = scope === '@openai' && pkg.name === '@openai/codex'
      && Array.isArray(pkg.os) && Array.isArray(pkg.cpu)
      && Array.isArray(pkg.files) && pkg.files.every(name => name === 'vendor')
    assert.ok(pkg.name === `${scope}/${entry.name}` || codexAlias, 'Unexpected native package layout')
    rmSync(path, { recursive: true })
    removed.push(pkg.name)
  }
}
console.log(JSON.stringify({ piOnly: true, removedOptionalNativePackages: removed }))

const globalRoot = '/usr/lib/node_modules'
const retained = new Set([
  '@chaitin-ai/agent-compose-runtime', '@earendil-works/pi-coding-agent',
  'pi-mcp-adapter', 'npm', 'corepack',
])
for (const entry of readdirSync(globalRoot, { withFileTypes: true })) {
  const path = join(globalRoot, entry.name)
  if (entry.name.startsWith('@') && entry.isDirectory()) {
    for (const child of readdirSync(path)) {
      if (!retained.has(`${entry.name}/${child}`)) rmSync(join(path, child), { recursive: true, force: true })
    }
  } else if (!retained.has(entry.name)) rmSync(path, { recursive: true, force: true })
}

// Jupyter and its local Python environment are not used by the Pi chat/file
// profile. Debian's Python standard library and packaged pip remain available.
for (const path of [
  '/usr/local/lib/python3.11/dist-packages', '/usr/local/share/jupyter',
  '/root/.codex', '/root/.claude', '/root/.claude.json', '/root/.opencode', '/root/.dsh',
  '/root/.npm', '/root/.cache', '/var/lib/apt/lists',
]) rmSync(path, { recursive: true, force: true })
for (const bin of ['codex', 'claude', 'opencode', 'dsh', 'gemini']) {
  for (const prefix of ['/usr/bin', '/usr/local/bin']) rmSync(join(prefix, bin), { force: true })
}
for (const bin of readdirSync('/usr/local/bin')) {
  if (/^(jupyter|ipython|debugpy)(-|$)/.test(bin) || bin === 'jlpm' || bin === 'grpcurl') {
    rmSync(join('/usr/local/bin', bin), { force: true })
  }
}

const manifestPath = '/etc/agent-compose/guest-abi.json'
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
assert.equal(manifest.guestAbi, 1)
assert.ok(manifest.providers.pi, 'The source guest must declare its Pi capabilities')
writeFileSync(manifestPath, JSON.stringify({ guestAbi: 1, providers: { pi: manifest.providers.pi } }, null, 2) + '\n')

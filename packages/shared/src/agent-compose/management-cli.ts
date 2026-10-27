import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { getBundledAssetsDir } from '../utils/paths.ts';
import { getNodes, publicNodes } from './store.ts';
import { composeSshTunnels, sshFetch } from './ssh.ts';
import type { ComposeNode } from './types.ts';

const readMethods: Record<string, string[]> = {
  ProjectService: ['GetProject', 'ListProjects', 'GetScheduler', 'ListSchedulers', 'ListSchedulerEvents', 'ListProjectSchedulerEvents', 'GetSchedulerRun', 'ListSchedulerRuns', 'BatchGetLatestSchedulerRuns'],
  RunService: ['GetRun', 'ListRuns', 'FollowRunLogs', 'ListRunEvents', 'ListSandboxRunEvents'],
  SandboxService: ['GetSandbox', 'ListSandboxes', 'GetSandboxStats', 'ListSandboxHistory'],
  ImageService: ['GetImage', 'ListImages', 'InspectImage'],
  ResourceService: ['ResolveID'],
  LLMService: ['GetProvider', 'ListProviders', 'GetDefaultModel'],
  EngineService: ['GetCapabilities'],
  DashboardService: ['GetDashboardOverview'],
  VolumeService: ['ListVolumes', 'GetVolume', 'InspectVolume'],
  CacheService: ['ListCaches', 'InspectCache'],
};
export function managementRpcAllowed(path: string, mode: 'read' | 'write') {
  const match = /^\/agentcompose\.v2\.([A-Za-z]+)\/([A-Za-z]+)$/.exec(path);
  return !!match && (mode === 'write' || !!readMethods[match[1]!]?.includes(match[2]!));
}
const secretKey = /^(?:token)$|password|secret|authorization|cookie|api[_-]?key|private[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|bearer[_-]?token/i;
class ManagementUsageError extends Error {}
export function redactManagementOutput(text: string, token: string): string {
  const scrub = (value: any, key = ''): any => {
    if (secretKey.test(key) || key.toLowerCase() === 'headers') return '[redacted]';
    if (Array.isArray(value)) return value.map((entry) => key === 'env' && entry && typeof entry === 'object'
      ? { ...entry, value: '[redacted]' } : scrub(entry));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, scrub(entry, name)]));
    return value;
  };
  let result = text;
  try { result = JSON.stringify(scrub(JSON.parse(text)), null, 2); } catch { /* text logs/help */ }
  if (token) result = result.split(token).join('[redacted]');
  return result.replace(/Bearer\s+[^\s"'\\]+/gi, 'Bearer [redacted]');
}
export function selectManagementNode(selector: string): ComposeNode {
  const nodes = getNodes();
  const matches = nodes.filter((node) => node.id === selector || node.name === selector);
  if (matches.length !== 1) throw new ManagementUsageError('Choose one exact server ID from zo-compose servers');
  return matches[0]!;
}
export function managementBinary() {
  if (process.env.CRAFT_AGENT_COMPOSE_BINARY) return process.env.CRAFT_AGENT_COMPOSE_BINARY;
  const bins = [getBundledAssetsDir('bin'), process.env.CRAFT_RESOURCES_PATH && join(process.env.CRAFT_RESOURCES_PATH, 'bin'),
    process.env.CRAFT_SCRIPTS && join(dirname(process.env.CRAFT_SCRIPTS), 'bin'), resolve(import.meta.dir, '../../../../apps/electron/resources/bin')].filter(Boolean) as string[];
  const name = process.platform === 'win32' ? 'agent-compose-cli.exe' : 'agent-compose-cli';
  for (const candidate of bins.flatMap(bin => [join(bin, `${process.platform}-${process.arch}`, name), join(bin, name)]))
    if (existsSync(candidate)) return candidate;
  const installed = Bun.which('agent-compose');
  if (installed) return installed;
  throw new ManagementUsageError('Agent Compose CLI is missing. Prepare the platform CLI with bun run compose:prepare.');
}

/** One invocation, one registered server; native CLI owns command semantics. */
export async function runManagementCli(node: ComposeNode, mode: 'read' | 'write', args: string[], binary = managementBinary(), signal?: AbortSignal) {
  const roots = new Set(['--help', '-h', 'help', 'version', 'status', 'project', 'agent', 'ls', 'ps', 'stats', 'logs', 'inspect', 'run', 'exec', 'up', 'down', 'sandbox', 'scheduler', 'image', 'images', 'cache', 'volume', 'llm', 'abandon']);
  if (!roots.has(args[0]!) || args.some((arg) => /^--host(?:=|$)/.test(arg)) ||
    (mode === 'read' && args.some((arg) => /^(?:--file(?:=|$)|-f)/.test(arg))))
    throw new ManagementUsageError('Use a native management command without auth, daemon or --host overrides. Read mode does not load local --file sources.');
  const queries = new Set(['--help', '-h', 'help', 'version', 'status', 'ls', 'ps', 'stats', 'logs', 'inspect', 'images']);
  const queryGroups: Record<string, string[]> = { project: ['ls'], agent: ['ls'], sandbox: ['ls'],
    image: ['ls', 'inspect'], cache: ['ls', 'inspect'], volume: ['ls', 'inspect'], llm: ['ls', 'inspect'], scheduler: ['ls', 'inspect', 'history'] };
  const helpOnly = !args.includes('--') && args.some(arg => arg === '--help' || arg === '-h');
  if (mode === 'read' && !helpOnly && !queries.has(args[0]!) && !queryGroups[args[0]!]?.includes(args[1]!))
    throw new ManagementUsageError('This native command requires zo-compose write. Use read with native --help to inspect its usage.');
  const localToken = randomUUID();
  const root = mkdtempSync(join(tmpdir(), 'zo-compose-cli-'));
  const controller = new AbortController();
  const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const relay = Bun.serve({ hostname: '127.0.0.1', port: 0, maxRequestBodySize: 8 << 20, async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get('authorization') !== `Bearer ${localToken}`) return new Response('', { status: 401 });
    const version = request.method === 'GET' && url.pathname === '/api/version';
    if ((!version && (request.method !== 'POST' || !managementRpcAllowed(url.pathname, mode))) || url.search)
      return Response.json({ code: 'permission_denied', message: 'This operation requires zo-compose write and Zo execution permission' }, { status: 403 });
    try {
      const body = new Uint8Array(await request.arrayBuffer());
      if (body.byteLength > 8 << 20) return new Response('', { status: 413 });
      const headers = { 'content-type': request.headers.get('content-type') || 'application/json',
        'connect-protocol-version': request.headers.get('connect-protocol-version') || '1', authorization: `Bearer ${node.token}` };
      for (const name of ['content-encoding', 'connect-content-encoding', 'connect-accept-encoding']) {
        const value = request.headers.get(name);
        if (value) (headers as Record<string, string>)[name] = value;
      }
      const response = node.ssh
        ? await sshFetch(node, url.pathname, body, headers, requestSignal, version ? 'GET' : 'POST')
        : await fetch(node.url.replace(/\/$/, '') + url.pathname, { method: version ? 'GET' : 'POST', body: version ? undefined : body, headers, redirect: 'error', signal: requestSignal });
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error('Daemon redirect rejected'); }
      const responseHeaders = new Headers({ 'content-type': response.headers.get('content-type') || 'application/json' });
      for (const name of ['connect-content-encoding', 'connect-accept-encoding']) {
        const value = response.headers.get(name);
        if (value) responseHeaders.set(name, value);
      }
      return new Response(response.body, { status: response.status, headers: responseHeaders });
    } catch { return Response.json({ code: 'unavailable', message: 'Agent Compose server connection failed; the command was not replayed' }, { status: 503 }); }
  } });
  const host = `http://127.0.0.1:${relay.port}`;
  const configPath = join(root, 'config.yml');
  writeFileSync(configPath, JSON.stringify({ version: 1, hosts: { [host]: { token: localToken } } }), { mode: 0o600 });
  try {
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(TOKEN|PASSWORD|SECRET|API_KEY|PRIVATE_KEY)/i.test(key))), AGENT_COMPOSE_CONFIG: configPath, AGENT_COMPOSE_HOST: host };
    const child = spawn(binary, ['--host', host, '--json', '--timeout', '30s', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '', oversized = false;
    const abort = () => { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 1000).unref(); };
    requestSignal.addEventListener('abort', abort, { once: true });
    if (requestSignal.aborted) abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort(); }, 120_000);
    child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8');
    for (const [stream, kind] of [[child.stdout, 'out'], [child.stderr, 'err']] as const)
      stream?.on('data', (chunk) => {
        if (oversized) return;
        if (kind === 'out') stdout += chunk.toString(); else stderr += chunk.toString();
        if (stdout.length + stderr.length > 8 << 20) { oversized = true; abort(); }
      });
    try {
      const code = await new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('close', (status) => resolve(status ?? 1)); });
      const clean = (text: string) => redactManagementOutput(redactManagementOutput(text, node.token), localToken);
      return { code: oversized || timedOut ? 1 : code, stdout: oversized ? '' : clean(stdout), stderr: clean(oversized ? 'CLI output exceeded 8 MiB. Query a smaller page.' : timedOut ? 'CLI observation timed out. Inspect remote state before retrying; a submitted remote run may still be active.' : stderr) };
    } finally { clearTimeout(timer); requestSignal.removeEventListener('abort', abort); }
  } finally { controller.abort(); relay.stop(true); composeSshTunnels.closeAll(); rmSync(root, { recursive: true, force: true }); }
}
const help = 'zo-compose servers\nzo-compose read <server-id-or-exact-name> -- <agent-compose command and arguments>\nzo-compose write <server-id-or-exact-name> -- <agent-compose command and arguments>\nRead mode blocks mutating daemon RPCs. Write mode follows Zo Bash execution permission. Use native --help to discover commands. No --host, auth or daemon commands.\n';
export async function managementMain(args: string[]) {
  // Pi injects model-provider proxy settings into its tool process. This dedicated
  // CLI uses saved direct/SSH connections, not the model's HTTP proxy route.
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) delete process.env[key];
  process.env.NO_PROXY = '*'; process.env.no_proxy = '*';
  if (!args.length || ['--help', 'help', '-h'].includes(args[0]!)) { console.log(help); return 0; }
  if (args[0] === 'servers' && args.length === 1) { console.log(JSON.stringify(publicNodes().map(({ id, name, url, ssh }) => ({ id, name, url, sshHost: ssh?.host })), null, 2)); return 0; }
  const [mode, selector, separator, ...command] = args;
  if (!['read', 'write'].includes(mode!) || !selector || separator !== '--') throw new ManagementUsageError(help);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    const result = await runManagementCli(selectManagementNode(selector), mode as 'read' | 'write', command, undefined, controller.signal);
    if (result.stdout) process.stdout.write(result.stdout + '\n');
    if (result.stderr) process.stderr.write(result.stderr + '\n');
    return result.code;
  } finally { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); }
}
if (import.meta.main) managementMain(process.argv.slice(2)).then((code) => { process.exitCode = code; })
  .catch((error) => { console.error(error instanceof ManagementUsageError ? error.message : 'zo-compose failed. Check the selected server and native command help; credentials were not printed.'); process.exitCode = 1; });

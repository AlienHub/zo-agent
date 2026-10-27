import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Build input is an upstream native executable, never a machine-specific shell shim. */
export async function prepareComposeCli(platform = process.platform as string, arch = process.arch as string, supplied = process.env.CRAFT_AGENT_COMPOSE_BINARY) {
  const folder = resolve(import.meta.dir, '../apps/electron/resources/bin', `${platform}-${arch}`);
  const output = join(folder, platform === 'win32' ? 'agent-compose-cli.exe' : 'agent-compose-cli');
  const input = supplied || output;
  if (!existsSync(input)) throw new Error(`Supply the native ${platform}-${arch} CLI with CRAFT_AGENT_COMPOSE_BINARY, then run bun run compose:prepare`);
  const data = readFileSync(input);
  if (data.length < 4096 || data.subarray(0, 2).toString() === '#!') throw new Error('Provide the native Agent Compose binary, not a shell wrapper');
  const sha256 = createHash('sha256').update(data).digest('hex');
  let version: { version: string; os: string; arch: string };
  if (platform === process.platform && arch === process.arch) {
    const child = Bun.spawn([resolve(input), 'version', '--json'], { stdout: 'pipe', stderr: 'pipe' });
    const text = await new Response(child.stdout).text();
    if (await child.exited !== 0) throw new Error('Unable to identify Agent Compose CLI version');
    version = JSON.parse(text);
  } else {
    const manifest = JSON.parse(readFileSync(`${input}.json`, 'utf8'));
    if (manifest.sha256 !== sha256) throw new Error('CLI checksum does not match its prepared manifest');
    version = manifest;
  }
  const expectedOS = platform === 'win32' ? 'windows' : platform;
  const expectedArch = arch === 'x64' ? 'amd64' : arch;
  if (!version.version || version.os !== expectedOS || version.arch !== expectedArch) throw new Error('Agent Compose CLI platform does not match build target');
  mkdirSync(folder, { recursive: true });
  if (resolve(input) !== output) copyFileSync(input, output);
  chmodSync(output, 0o755);
  writeFileSync(`${output}.json`, JSON.stringify({ ...version, sha256, source: 'https://github.com/chaitin/agent-compose' }, null, 2) + '\n');
  const bridge = await Bun.build({
    entrypoints: [resolve(import.meta.dir, '../packages/shared/src/agent-compose/management-cli.ts')],
    outdir: resolve(import.meta.dir, '../apps/electron/resources/scripts'),
    naming: 'zo-compose-cli.js', target: 'bun',
  });
  if (!bridge.success) throw new Error('Unable to bundle Zo Compose management entry');
  return { path: output, version: version.version, sha256 };
}
if (import.meta.main) console.log(JSON.stringify(await prepareComposeCli()));

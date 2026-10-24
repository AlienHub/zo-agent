import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComposeSshTunnels, spawnSshProcess, validateSshHost } from "./ssh.ts";
import type { ComposeNode } from "./types.ts";

const dir = mkdtempSync(join(tmpdir(), "zo-ssh-test-"));
const fake = join(dir, "ssh.cjs");
writeFileSync(fake, `
const net = require('node:net');
if(process.env.FAIL){process.stderr.write(process.env.FAIL);process.exit(255)}
const args=process.argv.slice(2), spec=args[args.indexOf('-L')+1].split(':');
const sockets=new Set();
const server=net.createServer(local=>{
 const remote=net.connect({host:spec[2],port:Number(spec[3])});
 sockets.add(local);sockets.add(remote);
 local.on('error',()=>remote.destroy());remote.on('error',()=>local.destroy());
 local.on('close',()=>{sockets.delete(local);remote.destroy()});remote.on('close',()=>sockets.delete(remote));
 local.pipe(remote).pipe(local);
});
setTimeout(()=>server.listen(Number(spec[1]),'127.0.0.1',()=>process.stderr.write('Local forwarding listening on 127.0.0.1 port '+spec[1]+'.\\n')),60);
process.on('SIGTERM',()=>{for(const socket of sockets)socket.destroy();server.close();process.exit(0)});
`);
let count = 0;
const daemon = Bun.serve({ port: 0, fetch: async (request) => { count++; return Response.json({ body: await request.text() }); } });
const node: ComposeNode = { id: "node", name: "SSH", url: `http://127.0.0.1:${daemon.port}`, token: "secret", ssh: { host: "existing-alias" } };
const managers: ComposeSshTunnels[] = [];
const children: ChildProcess[] = [];
function manager(fail?: string) {
  let starts = 0;
  const argsSeen: string[][] = [];
  const tunnels = new ComposeSshTunnels({ retryMs: 50, startupMs: 1000, spawn(args) {
    starts++; argsSeen.push(args);
    const child = spawn(process.execPath, [fake, ...args], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, ...(fail ? { FAIL: fail } : {}) } });
    children.push(child); return child;
  } });
  managers.push(tunnels);
  return { tunnels, argsSeen, starts: () => starts };
}
async function until(check: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await Bun.sleep(10);
  expect(check()).toBe(true);
}
afterEach(async () => {
  for (const tunnels of managers.splice(0)) tunnels.closeAll();
  await until(() => children.every((child) => child.exitCode !== null || child.signalCode !== null));
  children.length = 0;
});
afterAll(() => { daemon.stop(true); rmSync(dir, { recursive: true, force: true }); });

describe("OpenSSH tunnel lifecycle", () => {
  test("reuses one tunnel for concurrent callers and uses secure noninteractive OpenSSH options", async () => {
    const { tunnels, starts, argsSeen } = manager();
    const ports = await Promise.all(Array.from({ length: 8 }, () => tunnels.connect(node)));
    expect(new Set(ports).size).toBe(1); expect(starts()).toBe(1);
    const args = argsSeen[0]!;
    expect(args).toContain("StrictHostKeyChecking=yes"); expect(args).toContain("BatchMode=yes");
    expect(args).toContain("ExitOnForwardFailure=yes"); expect(args).toContain("ServerAliveInterval=15");
    expect(args.slice(-2)).toEqual(["--", "existing-alias"]);
    const reply = await fetch(`http://127.0.0.1:${ports[0]}/`, { method: "POST", body: "one-run" });
    expect(await reply.json()).toEqual({ body: "one-run" });
  });
  test("reconnects a dropped ssh process without replaying a request", async () => {
    const { tunnels, starts } = manager();
    const first = await tunnels.connect(node);
    await (await fetch(`http://127.0.0.1:${first}/`, { method: "POST", body: "exactly-once" })).text();
    const sent = count;
    children.at(-1)!.kill("SIGKILL");
    await until(() => tunnels.status(node.id).state === "reconnecting");
    const second = await tunnels.connect(node);
    expect(second).not.toBe(first); expect(starts()).toBe(2); expect(count).toBe(sent);
    expect((await fetch(`http://127.0.0.1:${second}/`)).status).toBe(200);
  });
  test("restored saved connections retry an initially offline host", async () => {
    let starts = 0;
    const tunnels = new ComposeSshTunnels({ retryMs: 30, startupMs: 1000, spawn(args) {
      const child = spawn(process.execPath, [fake, ...args], { stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, ...(starts++ === 0 ? { FAIL: "Connection refused" } : {}) } });
      children.push(child); return child;
    } });
    managers.push(tunnels); tunnels.maintain(node);
    await tunnels.connect(node);
    expect(starts).toBe(2); expect(tunnels.status(node.id).state).toBe("connected");
  });
  test("closing a connection during startup leaves no SSH child or retry", async () => {
    const { tunnels, starts } = manager();
    const pending = tunnels.connect(node);
    tunnels.close(node.id);
    await expect(pending).rejects.toMatchObject({ code: "ssh_closed" });
    await Bun.sleep(100); expect(starts()).toBe(0);
  });
  test("cancelling one waiter preserves other callers and the shared tunnel", async () => {
    const { tunnels, starts } = manager(), cancelled = new AbortController();
    const first = tunnels.connect(node, cancelled.signal);
    const second = tunnels.connect(node);
    cancelled.abort(new Error("caller stopped"));
    await expect(first).rejects.toThrow("caller stopped");
    await second; expect(starts()).toBe(1); expect(tunnels.status(node.id).state).toBe("connected");
  });
  test.each([
    ["Host key verification failed.", "ssh_host_key"],
    ["Permission denied (publickey).", "ssh_auth_failed"],
    ["Connection refused", "ssh_unreachable"],
  ] as const)("reports actionable error codes and never returns raw SSH stderr: %s", async (stderr, code) => {
    const { tunnels, starts } = manager(stderr);
    await expect(tunnels.connect(node)).rejects.toMatchObject({ code });
    expect(tunnels.status(node.id)).toEqual({ state: "error", error: code });
    expect(starts()).toBe(1);
  });
  test("disconnect cancels reconnect timers and terminates only owned processes", async () => {
    const { tunnels, starts } = manager();
    await tunnels.connect(node); children.at(-1)!.kill("SIGKILL");
    await until(() => tunnels.status(node.id).state === "reconnecting");
    tunnels.close(node.id); await Bun.sleep(120);
    expect(starts()).toBe(1); expect(tunnels.status(node.id).state).toBe("idle");
  });
  test("a changed SSH destination replaces its old tunnel", async () => {
    const { tunnels, starts } = manager();
    await tunnels.connect(node);
    await tunnels.connect({ ...node, ssh: { host: "other-alias" } });
    expect(starts()).toBe(2); await until(() => children[0]!.exitCode !== null || children[0]!.signalCode !== null);
  });
  test("the watchdog closes SSH when the owning process pipe disappears", async () => {
    const child = spawnSshProcess(["-L", `127.0.0.1:0:127.0.0.1:${daemon.port}`], process.execPath, [fake]);
    children.push(child);
    let started = false;
    child.stderr?.on("data", (data) => { if (String(data).includes("Local forwarding listening")) started = true; });
    await until(() => started);
    child.stdin!.end();
    await until(() => child.exitCode !== null || child.signalCode !== null);
    expect(child.exitCode).toBe(0);
  });
  test("missing OpenSSH is reported without leaking process errors", async () => {
    const tunnels = new ComposeSshTunnels({ spawn(args) {
      const child = spawnSshProcess(args, join(dir, "missing-ssh")); children.push(child); return child;
    } });
    managers.push(tunnels);
    await expect(tunnels.connect(node)).rejects.toMatchObject({ code: "ssh_unavailable" });
  });
  test("rejects SSH flags and command injection before starting a process", () => {
    for (const host of ["", "-oProxyCommand=bad", "host\n-oProxyCommand=x", "user@host;touch /tmp/x", "$(bad)"])
      expect(() => validateSshHost(host)).toThrow("ssh_invalid_host");
    expect(validateSshHost("user@existing-host")).toBe("user@existing-host");
    expect(validateSshHost("家用服务器")).toBe("家用服务器");
  });
});

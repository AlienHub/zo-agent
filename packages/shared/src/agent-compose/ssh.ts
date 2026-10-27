import { spawn, type ChildProcess } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { globSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { ComposeNode, ComposeSshStatus, ComposeSshErrorCode } from "./types.ts";

export class ComposeSshError extends Error {
  constructor(readonly code: ComposeSshErrorCode) { super(code); this.name = "ComposeSshError"; }
}
export function validateSshHost(host: string): string {
  if (typeof host !== "string") throw new ComposeSshError("ssh_invalid_host");
  const value = host.trim();
  if (!value || value.length > 255 || value.startsWith("-") || !/^[\p{L}\p{N}_.@:[\]%-]+$/u.test(value))
    throw new ComposeSshError("ssh_invalid_host");
  return value;
}
/** Read aliases only. OpenSSH itself resolves Include, Match, keys and jump hosts. */
export function listSshHosts(): string[] {
  const hosts = new Set<string>(), seen = new Set<string>();
  const read = (path: string, depth: number) => {
    if (depth > 8 || seen.size >= 128 || seen.has(path)) return;
    seen.add(path);
    let content: string;
    try { content = readFileSync(path, "utf8"); } catch { return; }
    for (const line of content.split(/\r?\n/)) {
      const parts = line.match(/"[^"]*"|'[^']*'|[^\s=]+/g) ?? [];
      const keyword = parts.shift()?.toLowerCase();
      for (const raw of parts) {
        if (raw.startsWith("#")) break;
        const value = raw.replace(/^['"]|['"]$/g, "");
        if (keyword === "host" && !/[*!?]/.test(value)) {
          try { hosts.add(validateSshHost(value)); } catch { /* pattern, not an alias */ }
        } else if (keyword === "include") {
          const pattern = value.startsWith("~/") ? join(homedir(), value.slice(2))
            : isAbsolute(value) ? value : join(homedir(), ".ssh", value);
          try { for (const match of globSync(pattern)) read(match, depth + 1); } catch { /* optional include */ }
        }
      }
    }
  };
  read(join(homedir(), ".ssh", "config"), 0);
  return [...hosts].sort();
}

interface Deferred {
  promise: Promise<number>;
  resolve: (port: number) => void;
  reject: (error: Error) => void;
}
function deferred(): Deferred {
  let resolve!: Deferred["resolve"], reject!: Deferred["reject"];
  const promise = new Promise<number>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => {}); // a reconnect may start before the next observer arrives
  return { promise, resolve, reject };
}
interface Tunnel {
  node: ComposeNode;
  fingerprint: string;
  status: ComposeSshStatus;
  ready: Deferred;
  child?: ChildProcess;
  timer?: ReturnType<typeof setTimeout>;
  cancelStartup?: () => void;
  autoReconnect: boolean;
  failures: number;
  stopped: boolean;
}
export function sshFingerprint(node: Pick<ComposeNode, "url" | "ssh">): string {
  return JSON.stringify([node.url.trim().replace(/\/$/, ""), node.ssh ? (typeof node.ssh.host === "string" ? node.ssh.host.trim() : "<invalid>") : ""]);
}
function classify(stderr: string, error?: NodeJS.ErrnoException): ComposeSshErrorCode {
  if (error?.code === "ENOENT" || stderr.includes("ZO_SSH_COMMAND_NOT_FOUND")) return "ssh_unavailable";
  if (/host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED|no .* host key is known/i.test(stderr)) return "ssh_host_key";
  if (/permission denied|authentication failed|sign_and_send_pubkey|agent refused operation/i.test(stderr)) return "ssh_auth_failed";
  return "ssh_unreachable";
}
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** A pipe watchdog closes SSH even if its owning Zo process is killed abruptly. */
export function spawnSshProcess(args: string[], command = "ssh", prefix: string[] = []): ChildProcess {
  const watchdog = `
    const {spawn}=require('node:child_process');
    const child=spawn(process.argv[1],process.argv.slice(2),{stdio:['ignore','ignore','pipe']});
    let stopping=false;
    function stop(){
      if(stopping)return;stopping=true;
      child.kill('SIGTERM');
      setTimeout(()=>child.kill('SIGKILL'),1000).unref();
      setTimeout(()=>process.exit(0),1400).unref();
    }
    process.stderr.on('error',()=>{});
    child.stderr.pipe(process.stderr);
    child.on('error',error=>{
      if(error.code==='ENOENT')process.stderr.write('ZO_SSH_COMMAND_NOT_FOUND');
      process.exit(127);
    });
    child.on('exit',(code)=>process.exit(stopping?0:(code||255)));
    process.stdin.on('end',stop);process.stdin.resume();
    process.on('SIGTERM',stop);process.on('SIGINT',stop);
  `;
  return spawn(process.execPath, ["-e", watchdog, "--", command, ...prefix, ...args], {
    stdio: ["pipe", "ignore", "pipe"], windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", SSH_ASKPASS_REQUIRE: "never" },
  });
}

/** Owns only the ssh children it starts. Reconnection never replays an HTTP request. */
export class ComposeSshTunnels {
  private tunnels = new Map<string, Tunnel>();
  constructor(private options: {
    spawn?: (args: string[]) => ChildProcess;
    retryMs?: number;
    startupMs?: number;
  } = {}) {}
  status(id: string): ComposeSshStatus { return this.tunnels.get(id)?.status ?? { state: "idle" }; }
  async connect(node: ComposeNode, signal?: AbortSignal): Promise<number> {
    signal?.throwIfAborted();
    if (!node.ssh) throw new ComposeSshError("ssh_invalid_host");
    validateSshHost(node.ssh.host);
    const url = new URL(node.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new Error("Invalid server URL");
    const fingerprint = sshFingerprint(node);
    let tunnel = this.tunnels.get(node.id);
    if (tunnel && (tunnel.fingerprint !== fingerprint || tunnel.status.state === "error")) {
      this.close(node.id); tunnel = undefined;
    }
    if (!tunnel) {
      tunnel = { node, fingerprint, status: { state: "connecting" }, ready: deferred(), autoReconnect: false, failures: 0, stopped: false };
      this.tunnels.set(node.id, tunnel);
      void this.start(tunnel);
    }
    return waitWithSignal(tunnel.ready.promise, signal);
  }
  /** Restore a saved connection after service restart, including an initially offline host. */
  maintain(node: ComposeNode): void {
    if (!node.ssh || this.tunnels.has(node.id)) return;
    void this.connect(node).catch(() => {});
    const tunnel = this.tunnels.get(node.id);
    if (tunnel) tunnel.autoReconnect = true;
  }
  close(id: string): void {
    const tunnel = this.tunnels.get(id);
    if (!tunnel) return;
    this.tunnels.delete(id);
    tunnel.stopped = true;
    clearTimeout(tunnel.timer);
    tunnel.cancelStartup?.();
    tunnel.ready.reject(new ComposeSshError("ssh_closed"));
    const child = tunnel.child;
    if (child) {
      child.kill("SIGTERM");
      const killTimer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 1500);
      killTimer.unref();
    }
  }
  closeAll(): void { for (const id of [...this.tunnels.keys()]) this.close(id); }
  private failed(tunnel: Tunnel, code: ComposeSshErrorCode): void {
    if (tunnel.stopped) return;
    const retry = tunnel.autoReconnect && code === "ssh_unreachable";
    if (!retry) {
      tunnel.status = { state: "error", error: code };
      tunnel.ready.reject(new ComposeSshError(code));
      return;
    }
    tunnel.status = { state: "reconnecting" };
    // Each outage has one shared readiness promise, including repeated failed attempts.
    const pause = Math.min(15_000, (this.options.retryMs ?? 500) * 2 ** Math.min(tunnel.failures++, 5));
    tunnel.timer = setTimeout(() => void this.start(tunnel), pause);
    tunnel.timer.unref();
  }
  private async start(tunnel: Tunnel): Promise<void> {
    let port: number;
    try { port = await freePort(); } catch { this.failed(tunnel, "ssh_unreachable"); return; }
    if (tunnel.stopped) return;
    const target = new URL(tunnel.node.url);
    const host = target.hostname.replace(/^\[|\]$/g, "");
    const remoteHost = host.includes(":") ? `[${host}]` : host;
    const args = ["-N", "-T", "-v", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
      "-o", "ExitOnForwardFailure=yes", "-o", "ConnectTimeout=8", "-o", "ConnectionAttempts=1",
      "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", "-o", "ControlMaster=no", "-o", "ControlPath=none",
      "-o", "PermitLocalCommand=no", "-o", "ForwardAgent=no", "-o", "ForwardX11=no",
      "-L", `127.0.0.1:${port}:${remoteHost}:${target.port || (target.protocol === "https:" ? "443" : "80")}`,
      "--", validateSshHost(tunnel.node.ssh!.host)];
    let child: ChildProcess;
    try {
      child = this.options.spawn?.(args) ?? spawnSshProcess(args);
    } catch (error) { this.failed(tunnel, classify("", error as NodeJS.ErrnoException)); return; }
    tunnel.child = child;
    let stderr = "", listening = false, ended = false, connected = false;
    let probe: ReturnType<typeof setTimeout> | undefined;
    let socket: ReturnType<typeof createConnection> | undefined;
    const cleanup = () => { clearTimeout(deadline); clearTimeout(probe); socket?.destroy(); };
    tunnel.cancelStartup = cleanup;
    const finish = (error?: NodeJS.ErrnoException) => {
      if (ended) return;
      ended = true; cleanup();
      if (tunnel.child === child) tunnel.child = undefined;
      if (tunnel.stopped) return;
      if (connected) tunnel.ready = deferred();
      this.failed(tunnel, classify(stderr, error));
    };
    child.stderr?.on("data", (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-8192);
      // Check OpenSSH's successful local bind before probing; an occupied port is never used.
      if (stderr.includes(`Local forwarding listening on 127.0.0.1 port ${port}.`)) listening = true;
    });
    child.once("error", finish);
    child.once("exit", () => finish());
    const deadline = setTimeout(() => { child.kill("SIGTERM"); finish(); }, this.options.startupMs ?? 12_000);
    deadline.unref();
    const check = () => {
      if (ended || connected || tunnel.stopped) return;
      if (!listening) { probe = setTimeout(check, 50); probe.unref(); return; }
      socket = createConnection({ host: "127.0.0.1", port });
      socket.setTimeout(300);
      const again = () => { socket?.destroy(); if (!ended && !connected) { probe = setTimeout(check, 50); probe.unref(); } };
      socket.once("error", again); socket.once("timeout", again);
      socket.once("connect", () => {
        if (ended || tunnel.stopped) return;
        connected = true; cleanup(); tunnel.cancelStartup = undefined;
        tunnel.status = { state: "connected" }; tunnel.autoReconnect = true; tunnel.failures = 0;
        tunnel.ready.resolve(port);
      });
    };
    check();
  }
}
export const composeSshTunnels = new ComposeSshTunnels();
process.once("exit", () => composeSshTunnels.closeAll());

/** Keep the original HTTPS SNI and Host header while connecting through loopback. */
export async function sshFetch(node: ComposeNode, path: string, body: string | Uint8Array, headers: Record<string, string>, signal: AbortSignal, method: 'POST' | 'GET' = 'POST'): Promise<Response> {
  const port = await composeSshTunnels.connect(node, signal);
  signal.throwIfAborted();
  const remote = new URL(node.url.replace(/\/$/, "") + path);
  return new Promise((resolve, reject) => {
    const request = (remote.protocol === "https:" ? httpsRequest : httpRequest)({
      hostname: "127.0.0.1", port, method, path: remote.pathname + remote.search,
      servername: remote.hostname.replace(/^\[|\]$/g, ""),
      headers: { ...headers, host: remote.host, "content-length": String(Buffer.byteLength(body)) },
      signal, agent: false,
    }, (response) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers))
        if (value !== undefined) responseHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
      resolve(new Response(Readable.toWeb(response) as unknown as ReadableStream<Uint8Array>, {
        status: response.statusCode ?? 502, headers: responseHeaders,
      }));
    });
    request.once("error", reject);
    request.end(body);
  });
}

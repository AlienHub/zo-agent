import { composeSshTunnels, sshFingerprint, validateSshHost } from "./ssh.ts";
import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  fsyncSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { CONFIG_DIR } from "../config/paths.ts";
import type {
  ComposeNode,
  PublicComposeNode,
  ComposeSessionState,
} from "./types.ts";

export function atomicJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  const directory = openSync(dirname(path), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
function json<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
}
const nodesPath = () => join(CONFIG_DIR, "agent-compose", "nodes.json");
export const getNodes = (): ComposeNode[] => json(nodesPath(), []);
export function publicNodes(): PublicComposeNode[] {
  return getNodes().map(({ token, ...node }) => ({
    ...node,
    hasToken: !!token,
  }));
}
export function getNode(id: string): ComposeNode {
  const node = getNodes().find((n) => n.id === id);
  if (!node) throw new Error("Agent-compose server is not configured");
  return node;
}
export function saveNode(input: Omit<ComposeNode, "id"> & { id?: string }) {
  const url = new URL(input.url.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Use an HTTP(S) server URL without embedded credentials");
  const nodes = getNodes(),
    old =
      nodes.find((n) => n.id === input.id) ??
      (!input.id
        ? nodes.find((n) => sshFingerprint(n) === sshFingerprint({ url: url.toString().replace(/\/$/, ""), ssh: input.ssh }))
        : undefined);
  const node: ComposeNode = {
    id: old?.id ?? randomUUID(),
    name: input.name.trim(),
    url: url.toString().replace(/\/$/, ""),
    token: input.token || old?.token || "",
    adminUrl: input.adminUrl,
    ...(input.ssh ? { ssh: { host: validateSshHost(input.ssh.host) } } : {}),
  };
  if (!node.name || !node.token)
    throw new Error("Server name and token are required");
  atomicJson(nodesPath(), [...nodes.filter((n) => n.id !== node.id), node]);
  if (old && sshFingerprint(old) !== sshFingerprint(node)) composeSshTunnels.close(old.id);
  return node;
}
export function removeNode(id: string) {
  composeSshTunnels.close(id);
  atomicJson(
    nodesPath(),
    getNodes().filter((n) => n.id !== id),
  );
}
export const statePath = (sessionPath: string) =>
  join(sessionPath, "agent-compose.json");
export const readState = (sessionPath: string) =>
  json<ComposeSessionState | null>(statePath(sessionPath), null);
export const writeState = (sessionPath: string, state: ComposeSessionState) =>
  atomicJson(statePath(sessionPath), state);

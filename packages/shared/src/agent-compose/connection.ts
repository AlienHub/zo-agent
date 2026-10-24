import { randomUUID } from "node:crypto";
import { ComposeSshError, composeSshTunnels, sshFingerprint, validateSshHost } from "./ssh.ts";
import { ComposeClient, ComposeRpcError } from "./client.ts";
import { getNodes } from "./store.ts";
import type { ComposeConnectionTest, ComposeNode } from "./types.ts";

export async function testNodeConnection(input: Omit<ComposeNode, "id"> & { id?: string }): Promise<ComposeConnectionTest> {
  let url: URL;
  try {
    url = new URL(input.url.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      return { ok: false, code: "invalid_url" };
  } catch {
    return { ok: false, code: "invalid_url" };
  }
  const old = input.id ? getNodes().find((node) => node.id === input.id) : undefined;
  const token = input.token || old?.token || "";
  if (!token.trim()) return { ok: false, code: "missing_token" };
  const transient = !old || sshFingerprint(old) !== sshFingerprint(input);
  const id = transient ? `probe-${randomUUID()}` : old.id;
  const started = performance.now();
  try {
    if (input.ssh) validateSshHost(input.ssh.host);
    // Read-only authenticated RPC: never saves credentials or starts inference.
    const result = await new ComposeClient({ ...input, id, url: url.toString().replace(/\/$/, ""), token })
      .call<unknown>("ProjectService", "ListProjects", { limit: 1 }, undefined, input.ssh ? 20_000 : 8000);
    if (!result || typeof result !== "object" || Array.isArray(result) ||
      Object.keys(result).some((key) => !["projects", "total"].includes(key)) ||
      ("projects" in result && !Array.isArray(result.projects)))
      return { ok: false, code: "invalid_response" };
    return { ok: true, code: "connected", latencyMs: Math.round(performance.now() - started) };
  } catch (error) {
    if (error instanceof ComposeSshError) return { ok: false, code: error.code };
    if (error instanceof ComposeRpcError) {
      const code = error.status === 401 ? "unauthorized" : error.status === 403 ? "forbidden" : error.status === 404 ? "not_daemon" : "server_error";
      return { ok: false, code };
    }
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))
      return { ok: false, code: "timeout" };
    return { ok: false, code: error instanceof SyntaxError ? "invalid_response" : "unreachable" };
  } finally {
    if (transient) composeSshTunnels.close(id);
  }
}

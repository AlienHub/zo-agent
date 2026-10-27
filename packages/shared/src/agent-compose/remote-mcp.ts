import { ComposeClient } from "./client.ts";
import { getProject, type NativeProject } from "./catalog.ts";
import { getNode } from "./store.ts";
import type { ComposeBinding } from "./types.ts";

/** Form values are transport DTOs; persisted definitions remain native MCPServerSpec. */
export interface RemoteMcpHeader {
  name: string;
  originalName?: string;
  hasValue?: boolean;
  /** Omitted keeps the saved value; removing the header row deletes it. */
  value?: string;
}
export interface RemoteMcpServer {
  originalName?: string;
  name: string;
  url: string;
  headers: RemoteMcpHeader[];
}
export interface AgentRemoteMcp {
  specHash: string;
  servers: RemoteMcpServer[];
  unmanagedCount: number;
}
interface NativeHeader { name: string; value?: string; secret?: boolean }
interface NativeMcp {
  name: string;
  type?: string;
  transport?: string;
  url?: string;
  headers?: NativeHeader[];
  env?: NativeHeader[];
  [key: string]: unknown;
}
function agentFor(project: NativeProject, binding: ComposeBinding) {
  const agent = project.spec.agents?.find((a: Record<string, unknown>) => a.name === binding.agentName);
  if (!agent) throw new Error("Agent no longer exists");
  return agent;
}
function resolveServer(project: NativeProject, server: NativeMcp): NativeMcp {
  if (server.type) return server;
  return project.spec.mcpServers?.find((m: NativeMcp) => m.name === server.name) ?? server;
}
function managed(server: NativeMcp) {
  return server.type === "remote" && server.transport === "http";
}
function nativeServers(project: NativeProject, binding: ComposeBinding): NativeMcp[] {
  return agentFor(project, binding).mcpServers ?? [];
}
function publicConfig(project: NativeProject, binding: ComposeBinding): AgentRemoteMcp {
  const servers = nativeServers(project, binding).map((m) => resolveServer(project, m));
  return {
    specHash: project.summary.specHash,
    servers: servers.filter(managed).map((m) => ({
      originalName: m.name, name: m.name, url: m.url ?? "",
      // Treat every header as sensitive, including imported headers not marked secret.
      headers: (m.headers ?? []).map((h) => ({ name: h.name, originalName: h.name, hasValue: !!h.value })),
    })),
    unmanagedCount: servers.filter((m) => !managed(m)).length,
  };
}
export async function getAgentRemoteMcp(binding: ComposeBinding): Promise<AgentRemoteMcp> {
  return publicConfig(await getProject(binding.nodeId, binding.projectId), binding);
}

/** Pure native patch builder: preserves unrelated agents, fields and unmanaged MCP. */
export function buildRemoteMcpPatch(project: NativeProject, input: {
  binding: ComposeBinding; specHash: string; servers: RemoteMcpServer[];
}): NativeProject["spec"] {
  if (project.summary.specHash !== input.specHash)
    throw new Error("Agent configuration changed. Close and reopen MCP settings before saving.");
  const agent = agentFor(project, input.binding);
  const running = project.agents.find((a) => a.agentName === input.binding.agentName)?.currentRun;
  if ((running?.runningRunCount ?? 0) + (running?.runningSchedulerRunCount ?? 0) > 0)
    throw new Error("Stop active runs before editing this agent");
  if (!Array.isArray(input.servers) || input.servers.length > 50)
    throw new Error("Too many MCP servers");
  const originals = nativeServers(project, input.binding);
  const resolved = originals.map((m) => resolveServer(project, m));
  const preserved = originals.filter((m) => !managed(resolveServer(project, m)));
  const names = new Set(preserved.map((m) => m.name));
  const originalNames = new Set<string>();
  const servers = input.servers.map((m): NativeMcp => {
    if (!m || typeof m.name !== "string" || !/^[a-z][a-z0-9_-]*$/.test(m.name) || m.name.length > 100 || names.has(m.name))
      throw new Error("MCP names must be unique lowercase identifiers");
    names.add(m.name);
    let previous: NativeMcp | undefined;
    if (m.originalName !== undefined) {
      previous = resolved.find((s) => s.name === m.originalName && managed(s));
      if (!previous || originalNames.has(m.originalName)) throw new Error("MCP configuration changed. Reload before saving.");
      originalNames.add(m.originalName);
    }
    if (typeof m.url !== "string" || m.url.length > 4096) throw new Error("Invalid MCP URL");
    let url: URL;
    try { url = new URL(m.url.trim()); } catch { throw new Error("Invalid MCP URL"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
      throw new Error("Use an HTTP(S) MCP URL without embedded credentials or a fragment");
    if (!Array.isArray(m.headers) || m.headers.length > 30) throw new Error("Too many MCP headers");
    const headerNames = new Set<string>();
    const headers = m.headers.map((h): NativeHeader => {
      if (!h || typeof h.name !== "string" || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(h.name) || h.name.length > 100 || headerNames.has(h.name.toLowerCase()))
        throw new Error("MCP header names must be valid and unique");
      headerNames.add(h.name.toLowerCase());
      const old = previous?.headers?.find((v) => v.name.toLowerCase() === h.name.toLowerCase());
      const value = h.value === undefined ? old?.value : h.value;
      // The daemon restores a marker at its exact existing resource path. A
      // server/header rename moves that path, so require a real replacement.
      if (value === "********" && (h.value !== undefined || m.name !== previous?.name || h.name !== old?.name))
        throw new Error("mcp_secret_value_required");
      if (typeof value !== "string" || !value || value.length > 16384 || /[\r\n\0]/.test(value))
        throw new Error("Enter a value for each new MCP header");
      return { name: h.name, value, secret: true };
    });
    // Resolve project-level references into agent-local overrides, leaving shared definitions untouched.
    const server: NativeMcp = { ...previous, name: m.name, type: "remote", transport: "http", url: url.toString(), headers };
    if (m.name !== previous?.name && Array.isArray(server.env) && server.env.some((v: NativeHeader) => v.value === "********"))
      throw new Error("mcp_secret_value_required");
    return server;
  });
  return {
    ...project.spec,
    agents: project.spec.agents.map((a: Record<string, unknown>) => a.name === agent.name
      ? { ...a, mcpServers: [...preserved, ...servers] } : a),
  };
}
export async function saveAgentRemoteMcp(input: {
  binding: ComposeBinding; specHash: string; servers: RemoteMcpServer[];
}): Promise<AgentRemoteMcp> {
  const project = await getProject(input.binding.nodeId, input.binding.projectId);
  const spec = buildRemoteMcpPatch(project, input);
  const result = await new ComposeClient(getNode(input.binding.nodeId)).call<{
    applied?: boolean; unchanged?: boolean; issues?: { severity?: string }[];
  }>("ProjectService", "PatchProject", {
    project: { projectId: input.binding.projectId }, expectedCurrentSpecHash: input.specHash, spec,
  });
  // Do not forward upstream validation text: it may contain submitted header values.
  if (result.issues?.some((i) => i.severity !== "VALIDATION_SEVERITY_WARNING") || (!result.applied && !result.unchanged))
    throw new Error("Agent Compose rejected the MCP configuration. Refresh and check the server configuration.");
  return getAgentRemoteMcp(input.binding);
}

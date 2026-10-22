import { createHash } from "node:crypto";
import { ComposeClient } from "./client.ts";
import { getNode, getNodes } from "./store.ts";
import {
  addLlmConnection,
  getLlmConnection,
  getLlmConnections,
  updateLlmConnection,
} from "../config/storage.ts";
import type { ComposeAgent, ComposeBinding } from "./types.ts";

export interface NativeProject {
  summary: {
    projectId: string;
    name: string;
    specHash: string;
    sourcePath?: string;
  };
  spec: Record<string, any>;
  agents: Array<{
    agentName: string;
    displayName?: string;
    provider: string;
    model: string;
    resolvedModel?: string;
    enabled: boolean;
    currentRun?: {
      runningRunCount?: number;
      runningSchedulerRunCount?: number;
    };
  }>;
}
export const connectionSlug = (b: ComposeBinding) =>
  `compose-${createHash("sha256")
    .update(JSON.stringify([b.nodeId, b.projectId, b.agentName]))
    .digest("hex")
    .slice(0, 24)}`;
export async function getProject(nodeId: string, projectId: string) {
  const { project } = await new ComposeClient(getNode(nodeId)).call<{
    project: NativeProject;
  }>("ProjectService", "GetProject", {
    project: { projectId },
    includeSpec: true,
  });
  return project;
}
export async function listAgents(
  nodeId?: string,
): Promise<{ agents: ComposeAgent[]; warnings: string[] }> {
  const results = await Promise.all(
    (nodeId ? [getNode(nodeId)] : getNodes()).map(async (node) => {
      const agents: ComposeAgent[] = [],
        warnings: string[] = [],
        client = new ComposeClient(node);
      try {
        let offset = 0;
        while (true) {
          const page = await client.call<{
            projects: Array<{ projectId: string; name: string }>;
            total: number;
          }>("ProjectService", "ListProjects", { offset, limit: 500 });
          const eligible = page.projects.filter(
              (p) => !/^chat-[0-9a-f]{32}$/.test(p.name),
            ),
            projects: NativeProject[] = [];
          for (let i = 0; i < eligible.length; i += 6)
            projects.push(
              ...(await Promise.all(
                eligible
                  .slice(i, i + 6)
                  .map((p) => getProject(node.id, p.projectId)),
              )),
            );
          for (const p of projects)
            for (const a of p.agents ?? [])
              agents.push({
                nodeId: node.id,
                projectId: p.summary.projectId,
                agentName: a.agentName,
                name: a.displayName || a.agentName,
                provider: a.provider,
                model: a.resolvedModel || a.model,
                enabled: a.enabled,
                specHash: p.summary.specHash,
                spec: publicAgentSpec(
                  p.spec.agents?.find((v: any) => v.name === a.agentName) ?? {},
                ),
              });
          offset += page.projects.length;
          if (!page.projects.length || offset >= page.total) break;
        }
      } catch {
        warnings.push(`${node.name}: unable to read agent-compose agents`);
      }
      return { agents, warnings };
    }),
  );
  return {
    agents: results.flatMap((r) => r.agents),
    warnings: results.flatMap((r) => r.warnings),
  };
}
/** Zo's existing connection selector is reused; the binding remains agent-compose-native. */
export function syncAgentConnections(agents: ComposeAgent[], complete = true) {
  if (complete)
    for (const c of getLlmConnections())
      if (
        c.compose &&
        !agents.some(
          (a) =>
            connectionSlug(a) === c.slug && a.enabled && a.provider === "pi",
        )
      )
        updateLlmConnection(c.slug, { composeUnavailable: true });
  for (const a of agents) {
    if (!a.enabled || a.provider !== "pi") continue;
    const slug = connectionSlug(a),
      node = getNode(a.nodeId);
    const update = {
      composeUnavailable: false,
      name: `${a.name} · ${node.name}`,
      providerType: "pi" as const,
      authType: "none" as const,
      models: [a.model],
      defaultModel: a.model,
      modelSelectionMode: "userDefined3Tier" as const,
      midStreamBehavior: "queue" as const,
      compose: {
        nodeId: a.nodeId,
        projectId: a.projectId,
        agentName: a.agentName,
      },
    };
    if (getLlmConnection(slug)) updateLlmConnection(slug, update);
    else addLlmConnection({ slug, ...update, createdAt: Date.now() });
  }
}
export async function editAgent(input: {
  binding: ComposeBinding;
  specHash: string;
  agent: Record<string, unknown>;
  remove?: boolean;
  dryRun?: boolean;
}) {
  const { binding } = input,
    p = await getProject(binding.nodeId, binding.projectId);
  if (p.summary.specHash !== input.specHash)
    throw new Error("Agent configuration changed. Refresh and try again.");
  const running = p.agents.find(
    (a) => a.agentName === binding.agentName,
  )?.currentRun;
  if (
    (running?.runningRunCount || 0) + (running?.runningSchedulerRunCount || 0) >
    0
  )
    throw new Error("Stop active runs before editing this agent");
  const agents = [...(p.spec.agents ?? [])],
    index = agents.findIndex((a: any) => a.name === binding.agentName);
  if (input.remove) {
    if (index < 0) throw new Error("Agent no longer exists");
    agents.splice(index, 1);
  } else {
    if (input.agent.name !== binding.agentName)
      throw new Error("Agent name cannot be changed");
    if (index < 0) throw new Error("Agent no longer exists");
    agents[index] = { ...agents[index], ...publicAgentSpec(input.agent) };
  }
  const client = new ComposeClient(getNode(binding.nodeId)),
    spec = { ...p.spec, agents };
  const result = await client.call<any>("ProjectService", "PatchProject", {
    project: { projectId: binding.projectId },
    expectedCurrentSpecHash: input.specHash,
    spec,
    dryRun: !!input.dryRun,
  });
  if (
    result.issues?.some(
      (i: any) => i.severity !== "VALIDATION_SEVERITY_WARNING",
    )
  )
    throw new Error("Agent-compose rejected this configuration");
  return result;
}

function publicAgentSpec(
  agent: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    [
      "name",
      "displayName",
      "description",
      "provider",
      "model",
      "image",
      "systemPrompt",
      "enabled",
    ]
      .filter((k) => k in agent)
      .map((k) => [k, agent[k]]),
  );
}
export async function createAgent(input: {
  nodeId: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  model: string;
  image?: string;
  requestId: string;
  dryRun?: boolean;
}) {
  if (!input.name.trim() || !input.model.trim())
    throw new Error("Agent name and model are required");
  const client = new ComposeClient(getNode(input.nodeId));
  const { agents } = await listAgents(input.nodeId);
  const template = agents.find((a) => a.provider === "pi");
  const name = `zo-${createHash("sha256").update(input.requestId).digest("hex").slice(0, 16)}`;
  const definition = {
    name,
    displayName: input.name.trim(),
    description: input.description || "",
    provider: "pi",
    model: input.model.trim(),
    systemPrompt: input.systemPrompt || "",
    enabled: true,
    ...(input.image ? { image: input.image } : {}),
  };
  let request: any, method: string;
  if (template) {
    const p = await getProject(input.nodeId, template.projectId);
    if (p.spec.agents.some((a: any) => a.name === name)) return p; // recover an ambiguous successful create
    const original = p.spec.agents.find(
      (a: any) => a.name === template.agentName,
    );
    const { scheduler, ...source } = original;
    request = {
      project: { projectId: template.projectId },
      expectedCurrentSpecHash: p.summary.specHash,
      spec: {
        ...p.spec,
        agents: [...p.spec.agents, { ...source, ...definition }],
      },
      dryRun: !!input.dryRun,
    };
    method = "PatchProject";
  } else {
    if (!input.image)
      throw new Error(
        "A Pi runtime image is required for the first agent on this server",
      );
    request = {
      spec: {
        name: `zo-agents-${name.slice(3, 11)}`,
        agents: [{ ...definition, driver: { name: "docker", docker: {} } }],
      },
      source: {
        projectDir: "/",
        composePath: `/zo-agents-${name.slice(3, 11)}.yml`,
      },
      dryRun: !!input.dryRun,
    };
    method = "ApplyProject";
  }
  const result = await client.call<any>(
    "ProjectService",
    method,
    request,
    undefined,
    180000,
  );
  const errors =
    result.issues?.filter(
      (i: any) => i.severity !== "VALIDATION_SEVERITY_WARNING",
    ) || [];
  if (errors.length || (!input.dryRun && !result.applied && !result.unchanged))
    throw new Error(
      errors.map((i: any) => `${i.path}: ${i.message}`).join("\n") ||
        "Agent configuration was not applied",
    );
  return result;
}

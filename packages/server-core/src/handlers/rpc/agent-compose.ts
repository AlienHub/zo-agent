import { nodeHasActiveRuns } from "@craft-agent/shared/agent-compose/usage";
import { RPC_CHANNELS } from "@craft-agent/shared/protocol";
import { pushTyped, type RpcServer } from "../../transport";
import type { HandlerDeps } from "../handler-deps";
import {
  publicNodes,
  saveNode,
  removeNode,
} from "@craft-agent/shared/agent-compose/store";
import { ComposeClient } from "@craft-agent/shared/agent-compose/client";
import {
  listAgents,
  syncAgentConnections,
  editAgent,
  createAgent,
  connectionSlug,
} from "@craft-agent/shared/agent-compose/catalog";
import type { ComposeRequest } from "@craft-agent/shared/agent-compose/api-types";

export const HANDLED_CHANNELS = [RPC_CHANNELS.agentCompose.REQUEST] as const;
export function registerAgentComposeHandlers(
  server: RpcServer,
  deps: HandlerDeps,
) {
  server.handle(
    RPC_CHANNELS.agentCompose.REQUEST,
    async (_ctx, request: ComposeRequest) => {
      if (!request || typeof request !== "object")
        throw new Error("Invalid agent-compose request");
      let draftSessionId: string | undefined;
      switch (request.action) {
        case "draftAgent": {
          if (!request.purpose.trim() || request.purpose.length > 12000)
            throw new Error("Describe the agent you want to create");
          const catalog = await listAgents(request.nodeId);
          const source = catalog.agents.find(
            (a) => a.enabled && a.provider === "pi",
          );
          if (!source)
            throw new Error(
              "Connect an available Pi agent to draft a configuration",
            );
          syncAgentConnections(catalog.agents, false);
          const session = await deps.sessionManager.createSession(
            request.workspaceId,
            {
              name: "Agent configuration draft",
              llmConnection: connectionSlug(source),
              hidden: true,
            },
          );
          draftSessionId = session.id;
          const prompt = `Draft an agent definition for the following user request. Do not use tools or change files or configurations. Return only a JSON object with three string fields: name (a short display name), description, systemPrompt. Use the user's language. Do not include credentials, servers, runtime settings, model names or workspace paths. User request:\n${request.purpose}`;
          await new Promise<void>((resolve, reject) => {
            let acked = false;
            void deps.sessionManager
              .sendMessage(
                session.id,
                prompt,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                () => {
                  acked = true;
                  resolve();
                },
              )
              .then(() => {
                if (!acked) resolve();
              })
              .catch(reject);
          });
          break;
        }
        case "saveNode": {
          // Verify credentials before replacing a saved connection. Never return the token.
          const { getNodes } = await import(
            "@craft-agent/shared/agent-compose/store"
          );
          const old = getNodes().find((n) => n.id === request.node.id);
          const node = {
            ...request.node,
            id: request.node.id || "probe",
            token: request.node.token || old?.token || "",
            url: request.node.url.trim().replace(/\/$/, ""),
          };
          if (old && old.url !== node.url && nodeHasActiveRuns(old.id))
            throw new Error(
              "Stop active runs before changing this server address",
            );
          const url = new URL(node.url);
          if (
            !["http:", "https:"].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash
          )
            throw new Error("Invalid server URL");
          await new ComposeClient(node).call("ProjectService", "ListProjects", {
            limit: 1,
          });
          saveNode(request.node);
          break;
        }
        case "removeNode":
          if (nodeHasActiveRuns(request.nodeId))
            throw new Error(
              "Stop active runs before disconnecting this server",
            );
          removeNode(request.nodeId);
          break;
        case "createAgent":
          await createAgent(request);
          break;
        case "editAgent":
          await editAgent(request);
          break;
        case "list":
        case "refresh":
          break;
        default:
          throw new Error("Unknown agent-compose action");
      }
      const result = await listAgents(
        request.action === "refresh" ? request.nodeId : undefined,
      );
      syncAgentConnections(result.agents, result.warnings.length === 0);
      pushTyped(server, RPC_CHANNELS.llmConnections.CHANGED, { to: "all" });
      return { nodes: publicNodes(), ...result, draftSessionId };
    },
  );
}

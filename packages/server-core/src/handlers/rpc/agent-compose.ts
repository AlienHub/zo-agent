import { composeSshTunnels, listSshHosts, sshFingerprint } from "@craft-agent/shared/agent-compose/ssh";
import { getAgentRemoteMcp, saveAgentRemoteMcp } from "@craft-agent/shared/agent-compose/remote-mcp";
import { nodeHasActiveRuns } from "@craft-agent/shared/agent-compose/usage";
import { RPC_CHANNELS } from "@craft-agent/shared/protocol";
import { pushTyped, type RpcServer } from "../../transport";
import type { HandlerDeps } from "../handler-deps";
import {
  publicNodes,
  saveNode,
  removeNode,
  getNode,
} from "@craft-agent/shared/agent-compose/store";
import { listImages } from "@craft-agent/shared/agent-compose/images";
import { testNodeConnection } from "@craft-agent/shared/agent-compose/connection";
import {
  listAgents,
  listModels,
  syncAgentConnections,
  editAgent,
  createAgent,
} from "@craft-agent/shared/agent-compose/catalog";
import type { ComposeRequest } from "@craft-agent/shared/agent-compose/api-types";

import { getLlmConnections, getDefaultLlmConnection } from "@craft-agent/shared/config";
import { getCredentialManager } from "@craft-agent/shared/credentials";
import { loadWorkspaceConfig } from "@craft-agent/shared/workspaces";
import { selectDraftConnection } from "@craft-agent/shared/agent-compose/draft";
import { getWorkspaceOrThrow } from "../utils";
import { startAgentDraft } from "../agent-compose-draft";

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
      if (request.action === "sshHosts")
        return { nodes: publicNodes(), agents: [], warnings: [], sshHosts: listSshHosts() };
      if (request.action === "sshStatus") {
        const { getNodes } = await import("@craft-agent/shared/agent-compose/store");
        const nodes = getNodes().filter((node) => node.ssh);
        for (const node of nodes) composeSshTunnels.maintain(node);
        return { nodes: publicNodes(), agents: [], warnings: [], sshStatuses: Object.fromEntries(
          nodes.map((node) => [node.id, composeSshTunnels.status(node.id)])) };
      }
      if (request.action === "getAgentRemoteMcp" || request.action === "saveAgentRemoteMcp") {
        const mcp = request.action === "getAgentRemoteMcp"
          ? await getAgentRemoteMcp(request.binding) : await saveAgentRemoteMcp(request);
        return { nodes: publicNodes(), agents: [], warnings: [], mcp };
      }
      if (request.action === "testNode") {
        const input = "nodeId" in request ? getNode(request.nodeId) : request.node;
        return { nodes: publicNodes(), agents: [], warnings: [], connectionTest: await testNodeConnection(input) };
      }
      if (request.action === "images") {
        const result = await listAgents(request.nodeId);
        return { nodes: publicNodes(), ...result, ...await listImages(getNode(request.nodeId), result.agents) };
      }
      if (request.action === "models") {
        const result = await listAgents(request.nodeId);
        return { nodes: publicNodes(), ...result, ...await listModels(request.nodeId, result.agents) };
      }
      if (request.action === "draftAgent") {
        const workspace = getWorkspaceOrThrow(request.workspaceId);
        const connection = selectDraftConnection(getLlmConnections(), request.llmConnection, [
          loadWorkspaceConfig(workspace.rootPath)?.defaults?.defaultLlmConnection,
          getDefaultLlmConnection(),
        ]);
        if (connection.authType !== "none" && !await getCredentialManager().hasLlmCredentials(connection.slug, connection.authType)) {
          throw new Error("Sign in to the selected Zo AI connection in Settings → AI before drafting");
        }
        const draftSessionId = await startAgentDraft(deps.sessionManager, workspace.id, connection, request.purpose);
        // Drafting must work even when the daemon has no agents or is offline.
        return { nodes: publicNodes(), agents: [], warnings: [], draftSessionId };
      }
      switch (request.action) {
        case "saveNode": {
          // Verify credentials before replacing a saved connection. Never return the token.
          const { getNodes } = await import(
            "@craft-agent/shared/agent-compose/store"
          );
          const old = getNodes().find((n) => n.id === request.node.id);
          if (old && sshFingerprint(old) !== sshFingerprint(request.node) && nodeHasActiveRuns(old.id))
            throw new Error("Stop active runs before changing this server connection");
          const result = await testNodeConnection(request.node);
          if (!result.ok) throw new Error(result.code);
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
      return { nodes: publicNodes(), ...result };
    },
  );
}

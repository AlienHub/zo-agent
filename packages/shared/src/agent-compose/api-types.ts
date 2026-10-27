import type { ComposeBinding, ComposeNode } from "./types.ts";
export type ComposeRequest =
  | { action: "list" }
  | { action: "history"; binding: ComposeBinding; offset?: number }
  | { action: "importHistory"; workspaceId: string; binding: ComposeBinding; target: import("./history.ts").HistoryTarget }
  | { action: "sshHosts" }
  | { action: "sshStatus" }
  | { action: "getAgentRemoteMcp"; binding: ComposeBinding }
  | { action: "saveAgentRemoteMcp"; binding: ComposeBinding; specHash: string; servers: import("./remote-mcp.ts").RemoteMcpServer[] }
  | { action: "models"; nodeId: string }
  | { action: "images"; nodeId: string }
  | { action: "testNode"; nodeId: string }
  | { action: "testNode"; node: Omit<ComposeNode, "id"> & { id?: string } }
  | {
      action: "draftAgent";
      llmConnection?: string;
      workspaceId: string;
      nodeId: string;
      purpose: string;
    }
  | {
      action: "createAgent";
      nodeId: string;
      name: string;
      description?: string;
      systemPrompt?: string;
      model: string;
      enabled?: boolean;
      image?: string;
      requestId: string;
      dryRun?: boolean;
    }
  | { action: "saveNode"; node: Omit<ComposeNode, "id"> & { id?: string } }
  | { action: "removeNode"; nodeId: string }
  | { action: "refresh"; nodeId?: string }
  | {
      action: "editAgent";
      binding: ComposeBinding;
      specHash: string;
      agent: Record<string, unknown>;
      remove?: boolean;
      dryRun?: boolean;
    };

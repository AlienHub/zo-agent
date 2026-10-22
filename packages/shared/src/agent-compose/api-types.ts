import type { ComposeBinding, ComposeNode } from "./types.ts";
export type ComposeRequest =
  | { action: "list" }
  | {
      action: "draftAgent";
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

/** Native agent-compose identities. Project IDs are transport bindings, not Zo projects. */
export interface ComposeBinding {
  nodeId: string;
  projectId: string;
  agentName: string;
}
export interface ComposeNode {
  id: string;
  name: string;
  url: string;
  token: string;
  adminUrl?: string;
}
export type PublicComposeNode = Omit<ComposeNode, "token"> & {
  hasToken: boolean;
};
export interface ComposeAgent extends ComposeBinding {
  name: string;
  model: string;
  provider: string;
  enabled: boolean;
  specHash: string;
  spec: Record<string, unknown>;
}
export interface ComposeSummary {
  runId: string;
  sandboxId: string;
  status: string;
  error?: string;
}
export interface ComposeRun {
  summary: ComposeSummary;
  prompt: string;
  output?: string;
  resultJson?: string;
}
export interface ComposeTurn {
  userPrompt?: string;
  uploads?: import("./uploads.ts").ComposeUpload[];
  uploadsReady?: boolean;
  setupRunId?: string;
  id: string;
  requestId: string;
  prompt: string;
  created: number;
  remoteId?: string;
  sandboxId?: string;
  status: string;
  stopRequested?: boolean;
  delivered?: boolean;
  eventCount: number;
  text: string;
  final?: string;
  error?: string;
}
export interface ComposeSessionState {
  version: 1;
  binding: ComposeBinding;
  sandboxId?: string;
  turns: ComposeTurn[];
}

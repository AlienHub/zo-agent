/** Native agent-compose identities. Project IDs are transport bindings, not Zo projects. */
export interface ComposeBinding {
  nodeId: string;
  projectId: string;
  agentName: string;
}
export type ComposeSshErrorCode = "ssh_invalid_host" | "ssh_unavailable" | "ssh_host_key" | "ssh_auth_failed" | "ssh_unreachable" | "ssh_closed";
export interface ComposeSshStatus {
  state: "idle" | "connecting" | "connected" | "reconnecting" | "error";
  error?: ComposeSshErrorCode;
}
export interface ComposeNode {
  id: string;
  name: string;
  url: string;
  token: string;
  adminUrl?: string;
  ssh?: { host: string };
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
export interface ComposeModelOption {
  id: string;
  name: string;
}
export interface ComposeImageOption {
  ref: string;
  local: boolean;
  usedByPi: boolean;
  platform?: string;
}
export interface ComposeConnectionTest {
  ok: boolean;
  code: ComposeSshErrorCode | "connected" | "invalid_url" | "missing_token" | "unauthorized" | "forbidden" | "not_daemon" | "timeout" | "unreachable" | "invalid_response" | "server_error";
  latencyMs?: number;
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

import { stageUploads, uploadFiles, promptWithUploads } from "./uploads.ts";
import { ComposeConfigurationError, composeRunError, isComposeRuntimeError } from "./errors.ts";
import { resolve, dirname } from "node:path";
import { claimLease, releaseLease } from "./leases.ts";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { BaseAgent } from "../agent/base-agent.ts";
import type { BackendConfig, ChatOptions } from "../agent/backend/types.ts";
import type { FileAttachment } from "../utils/files.ts";
import type { AgentEvent } from "@craft-agent/core/types";
import type { LLMQueryRequest, LLMQueryResult } from "../agent/llm-tool.ts";
import { AbortReason } from "../agent/core/index.ts";
import { getSessionPath } from "../sessions/storage.ts";
import { ComposeClient, ComposeRpcError, terminal } from "./client.ts";
import { getNode, readState, writeState } from "./store.ts";
import { getProject } from "./catalog.ts";
import { PI_JOURNAL } from "./journal.ts";
import type {
  ComposeBinding,
  ComposeRun,
  ComposeSessionState,
  ComposeSummary,
  ComposeTurn,
} from "./types.ts";

interface JournalEvent {
  seq: number;
  kind: string;
  data: {
    Text?: string;
    ToolID?: string;
    ToolName?: string;
    ToolInput?: Record<string, unknown>;
    ToolOutput?: string;
    ToolError?: boolean;
  };
}
interface JournalTurn {
  timestamp: number;
  prompt: string;
  events: JournalEvent[];
}
const toolName = (name: string) =>
  ({
    bash: "Bash",
    read: "Read",
    write: "Write",
    edit: "Edit",
    grep: "Grep",
    find: "Find",
    ls: "Ls",
  })[name] || name;

/** Remote execution adapter. Disposing an observer never stops a remote run. */
export class ComposeAgentBackend extends BaseAgent {
  protected backendName = "agent-compose";
  protected override _supportsBranching = false;
  private state: ComposeSessionState;
  private client: ComposeClient;
  private path: string;
  private observing?: AbortController;
  private processing = false;
  private detached = false;
  private savedSnapshot?: string;
  private current?: ComposeTurn;
  constructor(
    config: BackendConfig,
    readonly binding: ComposeBinding,
  ) {
    super(config, config.model || "");
    this.binding = {
      nodeId: binding.nodeId,
      projectId: binding.projectId,
      agentName: binding.agentName,
    };
    this.path = getSessionPath(config.workspace.rootPath, config.session!.id);
    this.state = readState(this.path) ?? { version: 1, binding, turns: [] };
    if (this.state.version !== 1)
      throw new Error("Unsupported remote conversation state version");
    if (
      this.state.binding.nodeId !== binding.nodeId ||
      this.state.binding.projectId !== binding.projectId ||
      this.state.binding.agentName !== binding.agentName
    )
      throw new Error("This session is bound to a different remote agent");
    this.state.binding = this.binding;
    this.client = new ComposeClient(getNode(binding.nodeId));
  }
  pendingTurn() {
    const turn = this.state.turns.at(-1);
    return turn && !turn.delivered ? turn : undefined;
  }
  acknowledgeDelivered(id: string) {
    const turn = this.state.turns.find((t) => t.id === id);
    if (turn && terminal(turn.status)) {
      turn.delivered = true;
      this.save();
    }
  }
  private save() {
    const snapshot = JSON.stringify(this.state);
    if (snapshot === this.savedSnapshot) return;
    writeState(this.path, this.state);
    this.savedSnapshot = snapshot;
  }
  isDetached() {
    return this.detached;
  }
  override getSessionId() {
    return (
      this.config.session?.sdkSessionId ?? `compose:${this.config.session!.id}`
    );
  }
  override setModel(model: string) {
    if (model !== this.getModel())
      throw new Error("The model is configured on the remote agent");
  }
  isProcessing() {
    return this.processing;
  }
  async respondToPermission() {
    return false;
  }
  async runMiniCompletion() {
    return null;
  }
  async queryLlm(_request: LLMQueryRequest): Promise<LLMQueryResult> {
    throw new Error("Remote agent-compose manages model calls");
  }
  override async generateTitle(message: string) {
    return message.trim().slice(0, 48) || null;
  }
  override async regenerateTitle(messages: string[]) {
    return this.generateTitle(messages.at(-1) || "");
  }
  override destroy() {
    this.detached = true;
    this.observing?.abort();
    super.destroy();
  }
  async abort() {
    const turn = this.current ?? this.state.turns.at(-1);
    if (!turn || terminal(turn.status)) return;
    turn.stopRequested = true;
    this.save();
    if (turn.remoteId || turn.setupRunId)
      await this.client.call("RunService", "StopRun", {
        runId: turn.remoteId || turn.setupRunId,
        reason: "user_stop",
      });
  }
  forceAbort(_reason: AbortReason) {
    void this.abort().catch((e) =>
      this.onDebug?.(`Unable to stop remote run: ${e.message}`),
    );
  }
  // Remote prompt paths and sources belong to the sandbox, not this server's filesystem.
  override async *chat(
    message: string,
    attachments?: FileAttachment[],
    options?: ChatOptions,
  ): AsyncGenerator<AgentEvent> {
    yield* this.chatImpl(message, attachments, options);
  }
  protected async *chatImpl(
    message: string,
    attachments?: FileAttachment[],
    _options?: ChatOptions,
  ): AsyncGenerator<AgentEvent> {
    if (this.processing)
      throw new Error("This remote session is already running");
    let turn = this.state.turns.at(-1);
    if (!turn || terminal(turn.status)) {
      turn = {
        id: randomUUID(),
        requestId: randomUUID(),
        prompt: message,
        created: Date.now(),
        status: "submitting",
        eventCount: 0,
        text: "",
      };
      if (attachments?.length) {
        turn.userPrompt = message;
        turn.uploads = stageUploads(
          this.path,
          this.config.session!.id,
          turn.id,
          attachments,
        );
        turn.prompt = promptWithUploads(message, turn.uploads);
      }
      this.state.turns.push(turn);
      this.save();
    } else if ((turn.userPrompt ?? turn.prompt) !== message) {
      this.processing = false;
      throw new Error(
        "A previous remote run is still active. Reconnect to it or stop it before sending another message.",
      );
    }
    this.processing = true;
    this.observing = new AbortController();
    this.current = turn;
    this.config.onSdkSessionIdUpdate?.(this.getSessionId()!);
    try {
      yield* this.observe(turn, this.observing.signal);
    } finally {
      this.current = undefined;
      this.processing = false;
      this.observing = undefined;
    }
  }
  /** Server recovery consumes this generator without creating another user message or run. */
  async *recover(): AsyncGenerator<AgentEvent> {
    const turn = this.state.turns.at(-1);
    if (!turn || turn.delivered || this.processing) return;
    turn.eventCount = 0;
    turn.text = "";
    this.save();
    this.processing = true;
    this.current = turn;
    this.observing = new AbortController();
    try {
      yield* this.observe(turn, this.observing.signal);
    } finally {
      this.processing = false;
      this.current = undefined;
      this.observing = undefined;
    }
  }
  private async submit(turn: ComposeTurn, signal: AbortSignal) {
    const p = await getProject(this.binding.nodeId, this.binding.projectId);
    const agent = p.agents.find((a) => a.agentName === this.binding.agentName);
    if (!agent?.enabled || agent.provider !== "pi")
      throw new ComposeConfigurationError(
        "Remote agent is disabled, removed, or not a Pi runtime",
      );
    // Agent-compose owns the model; never silently replace it with a local model.
    this._model = agent.resolvedModel || agent.model;
    const definition = p.spec.agents?.find(
      (a: any) => a.name === this.binding.agentName,
    );
    const workspace = definition?.workspace ?? p.spec.workspace;
    const key =
      workspace?.provider === "file" &&
      workspace.mode === "WORKSPACE_MODE_MOUNT"
        ? `${this.binding.nodeId}:workspace:${resolve(dirname(p.summary.sourcePath || "/compose.yml"), workspace.path)}`
        : `${this.binding.nodeId}:session:${this.config.session!.id}`;
    claimLease(key, turn.requestId, this.path);
    if (turn.uploads?.length && !turn.uploadsReady) {
      if (!this.state.sandboxId) {
        if (!turn.setupRunId) {
          const { run } = await this.client.call<{ run: ComposeSummary }>(
            "RunService",
            "StartAgentRun",
            {
              run: {
                projectId: this.binding.projectId,
                agentName: this.binding.agentName,
                command: "true",
                source: "RUN_SOURCE_API",
                cleanupPolicy: "RUN_SANDBOX_CLEANUP_POLICY_KEEP_RUNNING",
                clientRequestId: `${turn.requestId}:sandbox`,
              },
            },
            signal,
            180000,
          );
          turn.setupRunId = run.runId;
          this.save();
        }
        while (!signal.aborted) {
          if (turn.stopRequested)
            await this.client.call(
              "RunService",
              "StopRun",
              { runId: turn.setupRunId, reason: "user_stop" },
              signal,
            );
          const { run } = await this.client.call<{ run: ComposeRun }>(
            "RunService",
            "GetRun",
            { runId: turn.setupRunId },
            signal,
          );
          if (terminal(run.summary.status)) {
            this.state.sandboxId = run.summary.sandboxId;
            this.save();
            if (turn.stopRequested) {
              turn.status = "RUN_STATUS_CANCELED";
              this.save();
              releaseLease(turn.requestId);
              return;
            }
            if (
              run.summary.status !== "RUN_STATUS_SUCCEEDED" ||
              !this.state.sandboxId
            )
              throw new ComposeConfigurationError(
                "Unable to prepare the sandbox for attachments",
              );
            break;
          }
          await delay(500, undefined, { signal });
        }
      }
      if (turn.stopRequested) {
        turn.status = "RUN_STATUS_CANCELED";
        this.save();
        releaseLease(turn.requestId);
        return;
      }
      await uploadFiles(this.client, this.state.sandboxId!, turn.uploads);
      turn.uploadsReady = true;
      turn.prompt = promptWithUploads(
        turn.userPrompt || turn.prompt,
        turn.uploads,
      );
      this.save();
    }
    if (turn.stopRequested) {
      turn.status = "RUN_STATUS_CANCELED";
      this.save();
      releaseLease(turn.requestId);
      return;
    }
    const { run } = await this.client.call<{ run: ComposeSummary }>(
      "RunService",
      "StartAgentRun",
      {
        run: {
          projectId: this.binding.projectId,
          agentName: this.binding.agentName,
          prompt: turn.prompt,
          source: "RUN_SOURCE_API",
          cleanupPolicy: "RUN_SANDBOX_CLEANUP_POLICY_KEEP_RUNNING",
          clientRequestId: turn.requestId,
          ...(this.state.sandboxId ? { sandboxId: this.state.sandboxId } : {}),
        },
      },
      signal,
      180_000,
    );
    if (!run.runId) throw new Error("agent-compose returned no run ID");
    turn.remoteId = run.runId;
    turn.status = run.status;
    this.state.sandboxId = run.sandboxId || this.state.sandboxId;
    this.save();
  }
  private async *observe(
    turn: ComposeTurn,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    let failures = 0,
      emittedText = turn.text,
      committedText = "",
      textIndex = 0;
    let connected = false;
    let streamOutput = turn.text,
      following = false;
    const follower = new AbortController();
    const followSignal = AbortSignal.any([signal, follower.signal]);
    const startFollowing = () => {
      if (following || !turn.remoteId) return;
      following = true;
      void (async () => {
        while (!followSignal.aborted) {
          try {
            for await (const chunk of this.client.follow(
              turn.remoteId!,
              Buffer.byteLength(streamOutput),
              followSignal,
            )) {
              const offset = Buffer.byteLength(streamOutput),
                data = Buffer.from(chunk.data),
                start = chunk.offset - data.length;
              if (start > offset) throw new Error("Transcript gap");
              if (chunk.offset > offset)
                streamOutput += data.subarray(offset - start).toString("utf8");
            }
          } catch {}
          if (!followSignal.aborted)
            await delay(1000, undefined, { signal: followSignal }).catch(
              () => {},
            );
        }
      })();
    };
    yield { type: "status", message: "Connecting to agent-compose…" };
    try {
      while (!signal.aborted) {
        try {
          this.client = new ComposeClient(getNode(this.binding.nodeId));
          if (!turn.remoteId) await this.submit(turn, signal);
          if (terminal(turn.status) && !turn.remoteId) {
            yield { type: "complete" };
            return;
          }
          startFollowing();
          if (turn.stopRequested)
            await this.client.call(
              "RunService",
              "StopRun",
              { runId: turn.remoteId, reason: "user_stop" },
              signal,
            );
          const { run } = await this.client.call<{ run: ComposeRun }>(
            "RunService",
            "GetRun",
            { runId: turn.remoteId },
            signal,
          );
          if (!connected) {
            yield { type: "status", message: "Remote agent is working…" };
            connected = true;
          }
          failures = 0;
          turn.status = run.summary.status;
          this.state.sandboxId = run.summary.sandboxId || this.state.sandboxId;
          turn.sandboxId = this.state.sandboxId;
          let journal: JournalEvent[] = [];
          if (this.state.sandboxId) {
            try {
              const result = JSON.parse(
                await this.client.exec(this.state.sandboxId, PI_JOURNAL),
              ) as { turns: JournalTurn[] };
              journal =
                [...result.turns]
                  .reverse()
                  .find(
                    (t) =>
                      t.prompt === turn.prompt &&
                      t.timestamp >= turn.created - 1000,
                  )?.events ?? [];
            } catch {
              /* Sandbox may still be starting. Transcript observation remains available. */
            }
          }
          committedText = "";
          textIndex = 0;
          let processed = turn.eventCount;
          const done = terminal(turn.status);
          for (const e of journal) {
            if (e.kind === "text") {
              const text = e.data.Text || "",
                turnId = `${turn.id}:text:${textIndex++}`;
              const deferred = !done && e === journal.at(-1);
              if (deferred) {
                textIndex--;
                break;
              }
              if (e.seq > turn.eventCount)
                yield {
                  type: "text_complete",
                  text,
                  isIntermediate: !(
                    done &&
                    e === journal.at(-1) &&
                    turn.status === "RUN_STATUS_SUCCEEDED"
                  ),
                  turnId,
                };
              committedText += text;
            } else if (e.seq > turn.eventCount) {
              const turnId = `${turn.id}:text:${textIndex}`;
              if (e.kind === "tool-start")
                yield {
                  type: "tool_start",
                  toolName: toolName(e.data.ToolName || "Tool"),
                  toolUseId: e.data.ToolID || `${turn.id}:${e.seq}`,
                  input: e.data.ToolInput || {},
                  turnId,
                };
              else if (e.kind === "tool-end")
                yield {
                  type: "tool_result",
                  toolName: toolName(
                    journal.find(
                      (start) =>
                        start.kind === "tool-start" &&
                        start.data.ToolID === e.data.ToolID,
                    )?.data.ToolName || "Tool",
                  ),
                  toolUseId: e.data.ToolID || `${turn.id}:${e.seq}`,
                  result: e.data.ToolOutput || "",
                  isError: !!e.data.ToolError,
                  turnId,
                };
              else if (e.kind === "thinking") {
                const toolUseId = `${turn.id}:thinking:${e.seq}`;
                yield {
                  type: "tool_start",
                  toolName: "Thinking",
                  toolUseId,
                  input: {},
                  displayName: "Thinking",
                  turnId,
                };
                yield {
                  type: "tool_result",
                  toolUseId,
                  result: e.data.Text || "",
                  isError: false,
                  turnId,
                };
              }
            }
            processed = Math.max(processed, e.seq);
          }
          turn.eventCount = processed;
          const output =
            (run.output || "").length > streamOutput.length
              ? run.output!
              : streamOutput;
          // Stream the current uncommitted text, then let journal text_complete commit it.
          if (
            turn.status !== "RUN_STATUS_FAILED" &&
            !isComposeRuntimeError(output) &&
            output.startsWith(committedText) &&
            output.startsWith(emittedText) &&
            output.length > emittedText.length
          ) {
            const start = Math.max(emittedText.length, committedText.length);
            if (output.length > start)
              yield {
                type: "text_delta",
                text: output.slice(start),
                turnId: `${turn.id}:text:${textIndex}`,
              };
            emittedText = output;
          }
          turn.text = emittedText;
          turn.error = run.summary.error;
          this.save();
          failures = 0;
          if (terminal(turn.status)) {
            let result: { finalText?: string } = {};
            try {
              result = run.resultJson ? JSON.parse(run.resultJson) : {};
            } catch {}
            turn.final = result.finalText || "";
            this.save();
            releaseLease(turn.requestId);
            if (turn.status === "RUN_STATUS_SUCCEEDED") {
              const tail = output.startsWith(committedText)
                ? output.slice(committedText.length)
                : "";
              // Mark the last response final using its original turn ID.
              if (tail)
                yield {
                  type: "text_complete",
                  text: tail,
                  turnId: `${turn.id}:text:${textIndex}`,
                };
              else if (!journal.length && (turn.final || output))
                yield {
                  type: "text_complete",
                  text: turn.final || output,
                  turnId: `${turn.id}:text:0`,
                };
            } else if (turn.status === "RUN_STATUS_FAILED")
              yield {
                type: "error",
                message: composeRunError(run.summary.error, output),
              };
            yield { type: "complete" };
            return;
          }
        } catch (e) {
          if (signal.aborted) return;
          if (
            e instanceof ComposeConfigurationError ||
            (e instanceof ComposeRpcError &&
              [400, 401, 403, 404].includes(e.status))
          ) {
            if (!turn.remoteId) {
              turn.status = "RUN_STATUS_FAILED";
              turn.error = e.message;
              this.save();
              releaseLease(turn.requestId);
            }
            yield { type: "error", message: e.message };
            return;
          }
          connected = false;
          if (++failures === 1)
            yield {
              type: "status",
              message:
                "Connection interrupted. Reconnecting to the remote run…",
            };
        }
        await delay(
          Math.min(500 * 2 ** Math.min(failures, 4), 8000),
          undefined,
          { signal },
        ).catch(() => {});
      }
    } finally {
      follower.abort();
    }
  }
}

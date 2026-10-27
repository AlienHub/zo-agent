import { createHash } from "node:crypto";
import type { Message } from "@craft-agent/core/types";
import { ComposeClient, terminal } from "./client.ts";
import { getNode } from "./store.ts";
import { PI_JOURNAL } from "./journal.ts";
import { composeRunError, isComposeRuntimeError } from "./errors.ts";
import type { ComposeBinding, ComposeRun, ComposeSummary } from "./types.ts";

export interface HistoryTarget { sandboxId?: string; runId?: string }
export interface HistorySummary extends ComposeSummary {
  projectId: string;
  agentName: string;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
}
export interface ComposeHistoryItem {
  key: string;
  target: HistoryTarget;
  title: string;
  runIds: string[];
  updatedAt: number;
  active: boolean;
}
export interface ComposeHistoryPage {
  items: ComposeHistoryItem[];
  nextOffset?: number;
}
export interface ComposeHistoryArchive {
  key: string;
  binding: ComposeBinding;
  target: HistoryTarget;
  runIds: string[];
  title: string;
  createdAt: number;
  lastMessageAt: number;
  messages: Message[];
  warnings: string[];
}
const timestamp = (value?: string) => Date.parse(value || "") || 0;
const created = (run: HistorySummary) => timestamp(run.createdAt || run.startedAt);
export const historyRunPrefix = (runId: string) => `remote-${createHash("sha256").update(runId).digest("hex").slice(0, 24)}`;
export function historyKey(binding: ComposeBinding, target: HistoryTarget) {
  if (!!target.sandboxId === !!target.runId) throw new Error("Select one remote sandbox or run");
  return JSON.stringify([binding.nodeId, binding.projectId, binding.agentName,
    target.sandboxId ? "sandbox" : "run", target.sandboxId || target.runId]);
}
function checkIdentity(run: HistorySummary, binding: ComposeBinding) {
  if (!run.runId || run.projectId !== binding.projectId || run.agentName !== binding.agentName)
    throw new Error("Remote history does not belong to the selected agent");
}
async function mapLimited<T, R>(values: T[], fn: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < values.length; i += 4)
    results.push(...await Promise.all(values.slice(i, i + 4).map(fn)));
  return results;
}
export async function listHistory(binding: ComposeBinding, offset = 0): Promise<ComposeHistoryPage> {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid history offset");
  const client = new ComposeClient(getNode(binding.nodeId));
  const page = await client.call<{ runs?: HistorySummary[]; total?: number }>("RunService", "ListRuns", {
    projectId: binding.projectId, agentName: binding.agentName, offset, limit: 50,
  });
  const runs = page.runs ?? [];
  const details = await mapLimited(runs, async (summary) => {
    checkIdentity(summary, binding);
    const { run } = await client.call<{ run: ComposeRun & { summary: HistorySummary } }>("RunService", "GetRun", { runId: summary.runId });
    checkIdentity(run.summary, binding);
    return { summary: run.summary, prompt: run.prompt };
  });
  const groups = new Map<string, ComposeHistoryItem>();
  for (const run of details) {
    // Command-only setup/maintenance runs are not conversations.
    if (!run.prompt?.trim()) continue;
    const summary = run.summary;
    const target = summary.sandboxId ? { sandboxId: summary.sandboxId } : { runId: summary.runId };
    const key = historyKey(binding, target);
    const time = created(summary);
    const item = groups.get(key);
    if (item) {
      item.runIds.push(summary.runId);
      item.updatedAt = Math.max(item.updatedAt, time);
      item.active ||= !terminal(summary.status);
    } else groups.set(key, {
      key, target, title: run.prompt.trim().slice(0, 120), runIds: [summary.runId],
      updatedAt: time, active: !terminal(summary.status),
    });
  }
  const next = offset + runs.length;
  return { items: [...groups.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    ...(runs.length && next < (page.total ?? next) ? { nextOffset: next } : {}) };
}

/** Import is read-only: listing/reading history must never start or stop a run. */
export async function loadHistory(binding: ComposeBinding, target: HistoryTarget): Promise<ComposeHistoryArchive> {
  const key = historyKey(binding, target);
  const client = new ComposeClient(getNode(binding.nodeId));
  const summaries = new Map<string, HistorySummary>();
  if (target.runId) {
    const { run } = await client.call<{ run: ComposeRun & { summary: HistorySummary } }>("RunService", "GetRun", { runId: target.runId });
    checkIdentity(run.summary, binding);
    if (run.summary.sandboxId) throw new Error("Select this run's sandbox to import its conversation history");
    summaries.set(run.summary.runId, run.summary);
  } else {
    let offset = 0;
    while (true) {
      const page = await client.call<{ runs?: HistorySummary[]; total?: number }>("RunService", "ListRuns", {
        projectId: binding.projectId, agentName: binding.agentName, sandboxId: target.sandboxId, offset, limit: 500,
      });
      const runs = page.runs ?? [];
      for (const run of runs) {
        checkIdentity(run, binding);
        if (run.sandboxId !== target.sandboxId) throw new Error("Remote history sandbox mismatch");
        summaries.set(run.runId, run);
      }
      offset += runs.length;
      if (!runs.length || offset >= (page.total ?? offset)) break;
      if (offset >= 2000) throw new Error("Remote history exceeds 2000 runs; import a smaller history");
    }
  }
  if ([...summaries.values()].some((run) => !terminal(run.status)))
    throw new Error("Wait for this remote sandbox to finish before importing its history");
  let fetchedSize = 0;
  const runs = (await mapLimited([...summaries.values()], async (summary) => {
    const { run } = await client.call<{ run: ComposeRun & { summary: HistorySummary } }>("RunService", "GetRun", { runId: summary.runId });
    checkIdentity(run.summary, binding);
    if (target.sandboxId && run.summary.sandboxId !== target.sandboxId) throw new Error("Remote history sandbox mismatch");
    if (!terminal(run.summary.status)) throw new Error("Remote history is still running");
    fetchedSize += (run.prompt || "").length + (run.output || "").length + (run.resultJson || "").length;
    if (fetchedSize > 16 << 20) throw new Error("Remote history exceeds 16 MiB; no partial history was imported");
    return run;
  })).filter((run) => run.prompt?.trim()).sort((a, b) => created(a.summary) - created(b.summary) || a.summary.runId.localeCompare(b.summary.runId));
  if (!runs.length) throw new Error("No conversation history is available for this selection");
  const warnings: string[] = [];
  let journal: Array<{ timestamp: number; prompt: string; events: Array<{ kind: string; seq: number; data: Record<string, any> }> }> = [];
  if (target.sandboxId) {
    try { journal = JSON.parse(await client.exec(target.sandboxId, PI_JOURNAL)).turns ?? []; }
    catch { warnings.push("journal_unavailable"); }
  }
  const used = new Set<object>();
  const messages: Message[] = [];
  let size = 0;
  for (const run of runs) {
    const time = created(run.summary);
    const prefix = historyRunPrefix(run.summary.runId);
    const turnId = `${prefix}:turn`;
    let messageIndex = 0;
    const add = (message: Omit<Message, "id" | "timestamp">) => {
      size += JSON.stringify(message).length;
      if (size > 16 << 20) throw new Error("Remote history exceeds 16 MiB; no partial history was imported");
      messages.push({ id: `${prefix}:${messageIndex++}`, timestamp: time, turnId, ...message });
    };
    add({ role: "user", content: run.prompt });
    const native = journal.find((entry) => !used.has(entry) && entry.prompt === run.prompt &&
      entry.timestamp >= time - 1000 && (!run.summary.completedAt || entry.timestamp <= timestamp(run.summary.completedAt) + 1000));
    if (native) used.add(native);
    else if (target.sandboxId) warnings.push("journal_unavailable");
    const events = native?.events ?? [];
    const tools = new Map<string, Message>();
    for (const [index, event] of events.entries()) {
      const data = event.data;
      if (event.kind === "text") add({ role: "assistant", content: data.Text || "",
        isIntermediate: index !== events.length - 1 || run.summary.status !== "RUN_STATUS_SUCCEEDED" });
      else if (event.kind === "tool-start" || event.kind === "thinking") {
        const thinking = event.kind === "thinking";
        add({ role: "tool", content: "", toolUseId: `${prefix}:${data.ToolID || event.seq}`,
          toolName: thinking ? "Thinking" : ({ bash: "Bash", read: "Read", write: "Write", edit: "Edit" } as Record<string, string>)[data.ToolName] || data.ToolName || "Tool",
          toolInput: thinking ? {} : data.ToolInput || {}, toolResult: thinking ? data.Text : undefined,
          toolStatus: thinking ? "completed" : "error" });
        if (!thinking) tools.set(data.ToolID, messages.at(-1)!);
      } else if (event.kind === "tool-end") {
        const tool = tools.get(data.ToolID);
        if (tool) { tool.toolResult = data.ToolOutput || ""; tool.toolStatus = data.ToolError ? "error" : "completed"; tool.isError = !!data.ToolError; }
      }
    }
    if (!events.some((event) => event.kind === "text")) {
      let final = "";
      try { const value = JSON.parse(run.resultJson || "{}").finalText; if (typeof value === "string") final = value; } catch { /* use persisted output */ }
      if (final || (run.output && !isComposeRuntimeError(run.output) && run.summary.status !== "RUN_STATUS_FAILED"))
        add({ role: "assistant", content: final || run.output || "" });
      else if (run.summary.status === "RUN_STATUS_SUCCEEDED") {
        warnings.push("output_unavailable");
        add({ role: "info", content: "Remote output is no longer available." });
      }
    }
    if (run.summary.status === "RUN_STATUS_FAILED") add({ role: "error", content: composeRunError(run.summary.error, run.output || "") });
    else if (run.summary.status === "RUN_STATUS_CANCELED") add({ role: "info", content: "Remote run was stopped." });
  }
  // Account for tool results assigned after tool-start messages were added.
  if (JSON.stringify(messages).length > 16 << 20) throw new Error("Remote history exceeds 16 MiB");
  return { key, binding, target, title: runs[0]!.prompt.trim().slice(0, 120),
    runIds: runs.map((run) => run.summary.runId), createdAt: created(runs[0]!.summary),
    lastMessageAt: timestamp(runs.at(-1)!.summary.completedAt) || created(runs.at(-1)!.summary),
    messages, warnings: [...new Set(warnings)] };
}

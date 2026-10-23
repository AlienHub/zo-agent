import { expect, test } from "bun:test";
import { startAgentDraft } from "./agent-compose-draft";
import type { ISessionManager } from "./session-manager-interface";
import type { LlmConnection } from "@craft-agent/shared/config";

const connection = { slug: "zo-chatgpt", defaultModel: "pi/gpt-6.1-sol" } as LlmConnection;

test("Zo drafts use an isolated native session and return after durable acknowledgement", async () => {
  let created: any;
  let message = "";
  let finish!: () => void;
  const running = new Promise<void>((resolve) => { finish = resolve; });
  const sessions = {
    async createSession(workspace: string, options: any) { created = { workspace, options }; return { id: "draft-session" }; },
    async sendMessage(...args: any[]) { message = args[1]; args[7]("message"); await running; },
    async deleteSession() { throw new Error("an acknowledged draft must survive detachment"); },
  } as unknown as ISessionManager;
  try {
    expect(await startAgentDraft(sessions, "workspace", connection, "Help me write reports")).toBe("draft-session");
    expect(created).toEqual({ workspace: "workspace", options: {
      name: "Agent configuration draft", llmConnection: "zo-chatgpt", model: "pi/gpt-6.1-sol",
      thinkingLevel: "low", permissionMode: "safe", workingDirectory: "none", enabledSourceSlugs: [], codingMode: false, hidden: true, unattended: true,
    } });
    expect(message).toContain("Help me write reports");
    expect(message).toContain("Do not use tools");
    expect(message).toContain("review and save");
  } finally { finish(); }
});

test("submission failures clean up the unreachable hidden session", async () => {
  const deleted: string[] = [];
  const sessions = {
    async createSession() { return { id: "failed-draft" }; },
    async sendMessage() { throw new Error("not signed in"); },
    async deleteSession(id: string) { deleted.push(id); },
  } as unknown as ISessionManager;
  await expect(startAgentDraft(sessions, "workspace", connection, "writer")).rejects.toThrow("not signed in");
  expect(deleted).toEqual(["failed-draft"]);
});

test("invalid purposes create no sessions", async () => {
  const sessions = { async createSession() { throw new Error("must not create"); } } as unknown as ISessionManager;
  for (const purpose of ["", " ", "x".repeat(12001)]) {
    await expect(startAgentDraft(sessions, "workspace", connection, purpose)).rejects.toThrow("Describe the agent");
  }
});

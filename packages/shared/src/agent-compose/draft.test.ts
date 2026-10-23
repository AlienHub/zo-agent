import { describe, expect, test } from "bun:test";
import { parseAgentDraft, selectDraftConnection } from "./draft";
import type { LlmConnection } from "../config/llm-connections";

const local = { slug: "zo-chatgpt", name: "ChatGPT", providerType: "pi", authType: "oauth", defaultModel: "pi/gpt-6.1-sol" } as LlmConnection;
const second = { ...local, slug: "zo-api" };
const remote = { ...local, slug: "compose-pi", compose: { nodeId: "node", projectId: "p", agentName: "pi" } };

describe("Zo agent drafts", () => {
  test("uses Zo defaults and never falls back to a remote compose agent", () => {
    expect(selectDraftConnection([remote, local, second], undefined, [remote.slug, second.slug]).slug).toBe(second.slug);
    expect(selectDraftConnection([remote, local], local.slug).slug).toBe(local.slug);
    expect(() => selectDraftConnection([remote])).toThrow("Configure a Zo AI connection");
    expect(() => selectDraftConnection([remote, local], remote.slug)).toThrow("Choose a Zo AI connection");
    expect(() => selectDraftConnection([local], "removed-connection")).toThrow();
  });

  test("generated content cannot change models, credentials or deployment fields", () => {
    expect(parseAgentDraft('```json\n{"name":" Writer ","description":" Draft copy ","systemPrompt":" Help write clearly. ","model":"unrequested-model","image":"unrequested-image","apiKey":"secret"}\n```')).toEqual({
      name: "Writer", description: "Draft copy", systemPrompt: "Help write clearly.",
    });
  });

  test("rejects empty, malformed and excessive drafts so the existing form survives", () => {
    for (const text of ["", "hello", "null", '{"name":" ","systemPrompt":"x"}', '{"name":"Writer","systemPrompt":" "}', JSON.stringify({ name: "Writer", systemPrompt: "x".repeat(30001) })]) {
      expect(() => parseAgentDraft(text)).toThrow();
    }
  });
});

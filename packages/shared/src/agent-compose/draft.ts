import type { LlmConnection } from "../config/llm-connections.ts";

/** Drafting runs in Zo, never through a target daemon's agent binding. */
export function selectDraftConnection(
  connections: LlmConnection[],
  requestedSlug?: string,
  preferredSlugs: Array<string | null | undefined> = [],
): LlmConnection {
  const local = connections.filter((connection) => !connection.compose && !connection.composeUnavailable);
  if (requestedSlug) {
    const selected = local.find((connection) => connection.slug === requestedSlug);
    if (!selected) throw new Error("Choose a Zo AI connection to draft this agent");
    return selected;
  }
  const selected = preferredSlugs.map((slug) => local.find((connection) => connection.slug === slug)).find(Boolean) ?? local[0];
  if (!selected) throw new Error("Configure a Zo AI connection in Settings → AI before drafting an agent");
  return selected;
}

/** Only identity and prompt fields can be generated; deployment choices stay explicit. */
export function parseAgentDraft(text: string) {
  const value = JSON.parse(text.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, "").trim());
  if (!value || typeof value.name !== "string" || !value.name.trim() ||
      typeof value.systemPrompt !== "string" || !value.systemPrompt.trim() || value.systemPrompt.length > 30000) {
    throw new Error("Invalid agent draft");
  }
  return {
    name: value.name.trim().slice(0, 100),
    description: typeof value.description === "string" ? value.description.trim().slice(0, 2000) : "",
    systemPrompt: value.systemPrompt.trim(),
  };
}

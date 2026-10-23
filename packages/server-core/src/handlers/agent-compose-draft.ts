import type { ISessionManager } from "./session-manager-interface";
import type { LlmConnection } from "@craft-agent/shared/config";

/** Use Zo's regular agent/session execution so stop and reconnect keep working. */
export async function startAgentDraft(
  sessions: Pick<ISessionManager, "createSession" | "sendMessage" | "deleteSession">,
  workspaceId: string,
  connection: LlmConnection,
  purpose: string,
): Promise<string> {
  if (typeof purpose !== "string" || !purpose.trim() || purpose.length > 12000) {
    throw new Error("Describe the agent you want to create");
  }
  const session = await sessions.createSession(workspaceId, {
    name: "Agent configuration draft",
    llmConnection: connection.slug,
    model: connection.defaultModel,
    thinkingLevel: "low",
    permissionMode: "safe",
    workingDirectory: "none",
    enabledSourceSlugs: [],
    codingMode: false,
    hidden: true,
    unattended: true,
  });
  const prompt = `You are helping the user create an Agent Compose agent. Draft its identity and system instructions for the purpose below. Do not use tools, inspect files, or change any files or configuration. Return only a JSON object with three string fields: name (a short display name), description, systemPrompt. Use the user's language. Do not include credentials, servers, runtime settings, model names, workspace paths or deployment fields. The user will review and save the draft separately. User request:\n${purpose}`;
  try {
    await new Promise<void>((resolve, reject) => {
      void sessions.sendMessage(session.id, prompt, undefined, undefined, undefined, undefined, undefined, () => resolve())
        .then(resolve, reject);
    });
    return session.id;
  } catch (error) {
    // Before acknowledgement, do not leave an unreachable hidden draft behind.
    await sessions.deleteSession(session.id).catch(() => {});
    throw error;
  }
}

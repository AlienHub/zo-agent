import { readdirSync } from "node:fs";
import { join } from "node:path";
import { getWorkspaces } from "../config/storage.ts";
import { getWorkspaceSessionsPath } from "../workspaces/storage.ts";
import { readState } from "./store.ts";
import { terminal } from "./client.ts";
export function nodeHasActiveRuns(nodeId: string): boolean {
  for (const workspace of getWorkspaces()) {
    const root = getWorkspaceSessionsPath(workspace.rootPath);
    let entries: string[];
    try {
      entries = readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw e;
    }
    for (const entry of entries) {
      const state = readState(join(root, entry)),
        turn = state?.turns.at(-1);
      if (state?.binding.nodeId === nodeId && turn && !terminal(turn.status))
        return true;
    }
  }
  return false;
}

import { ComposeConfigurationError } from "./errors.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "../config/paths.ts";
import { atomicJson, readState } from "./store.ts";
import { terminal } from "./client.ts";
interface Lease {
  key: string;
  requestId: string;
  sessionPath: string;
}
const path = () => join(CONFIG_DIR, "agent-compose", "leases.json");
function load(): Lease[] {
  try {
    return JSON.parse(readFileSync(path(), "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
/** Synchronous claim before network submission. An ambiguous submission keeps its lease. */
export function claimLease(
  key: string,
  requestId: string,
  sessionPath: string,
) {
  const leases = load().filter((l) => {
    const state = readState(l.sessionPath),
      turn = state?.turns.find((t) => t.requestId === l.requestId);
    return !turn || !terminal(turn.status);
  });
  const active = leases.find((l) => l.key === key);
  if (active && active.requestId !== requestId)
    throw new ComposeConfigurationError(
      "Another conversation is running in this shared workspace. Stop it or wait before continuing.",
    );
  atomicJson(path(), [
    ...leases.filter((l) => l.requestId !== requestId),
    { key, requestId, sessionPath },
  ]);
}
export function releaseLease(requestId: string) {
  atomicJson(
    path(),
    load().filter((l) => l.requestId !== requestId),
  );
}

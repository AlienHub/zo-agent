import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = mkdtempSync(join(tmpdir(), "zo-compose-test-"));
process.env.CRAFT_CONFIG_DIR = root;
const { saveNode, publicNodes, readState, writeState } = await import(
  "./store.ts"
);
const { ComposeClient } = await import("./client.ts");
const { ComposeAgentBackend } = await import("./agent.ts");
const { getSessionPath } = await import("../sessions/storage.ts");
const { claimLease } = await import("./leases.ts");
let starts = 0,
  stops = 0,
  reads = 0,
  ambiguous = false,
  waiting = false,
  activeRequest = "",
  created = 0,
  requestIds: string[] = [],
  prompt = "";
const frames = (value: any) => {
  const data = new TextEncoder().encode(JSON.stringify(value)),
    out = new Uint8Array(data.length + 5);
  new DataView(out.buffer).setUint32(1, data.length);
  out.set(data, 5);
  return out;
};
const daemon = Bun.serve({
  port: 0,
  async fetch(req) {
    if (req.headers.get("authorization") !== "Bearer test-token")
      return new Response("", { status: 401 });
    const method = new URL(req.url).pathname.split("/").at(-1);
    if (method === "FollowRunLogs")
      return new Response(frames({ isFinal: true }), {
        headers: { "content-type": "application/connect+json" },
      });
    const body = (await req.json()) as any;
    if (method === "ListProjects") return Response.json({projects:[{projectId:"p",name:"native"}],total:1});
    if (method === "GetProject")
      return Response.json({
        project: {
          summary: { projectId: "p", specHash: "v1" },
          spec: { agents: [{ name: "pi", workspace: { token: "workspace-secret" }, env: [{name:"API_KEY", value:"env-secret"}] }] },
          agents: [
            {
              agentName: "pi",
              provider: "pi",
              model: "remote-model",
              enabled: true,
            },
          ],
        },
      });
    if (method === "StartAgentRun") {
      requestIds.push(body.run.clientRequestId);
      if (activeRequest !== body.run.clientRequestId) {
        starts++;
        activeRequest = body.run.clientRequestId;
        created = Date.now();
        prompt = body.run.prompt;
      }
      if (ambiguous) {
        ambiguous = false;
        return new Response("", { status: 503 });
      }
      return Response.json({
        run: {
          runId: activeRequest,
          sandboxId: "sandbox",
          status: "RUN_STATUS_RUNNING",
        },
      });
    }
    if (method === "StopRun") {
      stops++;
      waiting = false;
      return Response.json({});
    }
    if (method === "GetRun") {
      reads++;
      return Response.json({
        run: {
          summary: {
            runId: activeRequest,
            sandboxId: "sandbox",
            status: waiting
              ? "RUN_STATUS_RUNNING"
              : stops
                ? "RUN_STATUS_CANCELED"
                : "RUN_STATUS_SUCCEEDED",
          },
          output: waiting ? "" : "remote answer",
          resultJson: JSON.stringify({ finalText: "remote answer" }),
        },
      });
    }
    if (method === "Exec")
      return Response.json({
        result: {
          stdout: JSON.stringify({
            turns: [
              {
                id: "journal",
                timestamp: created,
                prompt,
                events: waiting
                  ? []
                  : [{ seq: 1, kind: "text", data: { Text: "remote answer" } }],
              },
            ],
          }),
        },
      });
    if (method === "FollowRunLogs")
      return new Response(frames({ isFinal: true }), {
        headers: { "content-type": "application/connect+json" },
      });
    return Response.json({});
  },
});
const node = saveNode({
  name: "Test",
  url: `http://127.0.0.1:${daemon.port}`,
  token: "test-token",
});
const binding = { nodeId: node.id, projectId: "p", agentName: "pi" };
function backend(id: string) {
  return new ComposeAgentBackend(
    {
      provider: "pi",
      model: "remote-model",
      workspace: { id: "w", name: "Test", rootPath: root, createdAt: 1 },
      session: { id, workspaceRootPath: root, createdAt: 1, lastUsedAt: 1 },
      skipConfigWatcher: true,
    } as any,
    binding,
  );
}
afterAll(() => {
  daemon.stop(true);
  rmSync(root, { recursive: true, force: true });
});
describe("agent-compose durable adapter", () => {
  test("does not expose node tokens and rejects credentials embedded in URLs", () => {
    expect(JSON.stringify(publicNodes())).not.toContain("test-token");
    expect(() =>
      saveNode({
        name: "bad",
        url: "http://user:pass@example.com",
        token: "x",
      }),
    ).toThrow();
  });
  test("catalog does not expose native workspace or environment credentials", async () => {
    const {listAgents} = await import("./catalog.ts");
    const result=JSON.stringify(await listAgents());
    expect(result).not.toContain("workspace-secret");
    expect(result).not.toContain("env-secret");
  });
  test("retries an ambiguous submission with the same idempotency key; emits one final response", async () => {
    starts = 0;
    stops = 0;
    ambiguous = true;
    requestIds = [];
    const agent = backend("ambiguous"),
      events = [];
    for await (const e of agent.chat("hello")) events.push(e);
    expect(starts).toBe(1);
    expect(new Set(requestIds).size).toBe(1);
    expect(requestIds.length).toBeGreaterThan(1);
    expect(events.filter((e) => e.type === "text_complete")).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("complete");
    agent.destroy();
  }, 15000);
  test("disposing the server observer keeps remote execution alive; a new observer resumes without submission", async () => {
    waiting = true;
    stops = 0;
    starts = 0;
    const agent = backend("recover"),
      stream = agent.chat("continue");
    await stream.next(); // connecting
    const next = stream.next();
    await Bun.sleep(150);
    agent.destroy();
    await next;
    expect(stops).toBe(0);
    expect(starts).toBe(1);
    waiting = false;
    const restored = backend("recover"),
      events = [];
    for await (const e of restored.recover()) events.push(e);
    expect(starts).toBe(1);
    expect(events.some((e) => e.type === "text_complete")).toBe(true);
    restored.destroy();
  }, 15000);
  test("a stop request reaches the daemon and persists across observer restart", async () => {
    waiting = true;
    stops = 0;
    const agent = backend("stop"),
      stream = agent.chat("slow");
    await stream.next();
    const next = stream.next();
    await Bun.sleep(150);
    await agent.abort();
    await next;
    for await (const _ of stream) {
    }
    const state = readState(getSessionPath(root, "stop"))!;
    expect(stops).toBeGreaterThan(0);
    expect(state.turns.at(-1)?.stopRequested).toBe(true);
    expect(state.turns.at(-1)?.status).toBe("RUN_STATUS_CANCELED");
    agent.destroy();
  }, 15000);
  test("shared-workspace leases survive observer shutdown and exclude a different session", () => {
    const path = getSessionPath(root, "lease");
    writeState(path, {
      version: 1,
      binding,
      turns: [
        {
          id: "turn",
          requestId: "lease-key",
          created: 1,
          prompt: "x",
          status: "RUN_STATUS_RUNNING",
          eventCount: 0,
          text: "",
        },
      ],
    });
    claimLease("node:/workspace", "lease-key", path);
    expect(() =>
      claimLease("node:/workspace", "other-key", getSessionPath(root, "other")),
    ).toThrow("Another conversation");
  });
});

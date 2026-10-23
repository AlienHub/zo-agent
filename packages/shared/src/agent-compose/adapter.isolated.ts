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
const failureOutput = 'Error: pi model request failed: 402: {"message":"成员余额不足","type":"permission_error"}\n    at PiRunner.handleEvent (file:///usr/lib/runtime/pi.js:295:49)';
let failed = false;
let modelCatalogUnavailable = false;
let emptyAgentCatalog = false;
let appliedSpec: any;
let patchedSpec: any;
let probeMode = "normal";
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
    if (method === "ApplyProject") {
      appliedSpec = body.spec;
      return Response.json({ applied: true });
    }
    if (method === "PatchProject") {
      patchedSpec = body.spec;
      return Response.json({});
    }
    if (method === "ListProviders") {
      if (modelCatalogUnavailable) return new Response("", { status: 404 });
      return Response.json({
        providers: body.offset ? [{ id: "disabled", enabled: false, models: [{ id: "disabled-model" }], capabilities: { models: ["disabled-discovered"] } }] : [{
          id: "glm-coding", name: "GLM", enabled: true,
          capabilities: { models: ["glm-5", "model-b", "glm-5", "vendor/model", "", "   "] },
          models: [{ id: "model-b", name: "Model B", headers: { authorization: "fixture-secret" } }, { id: "remote-model", name: "Current model" }],
        }],
        total: 2,
      });
    }
    if (method === "ListProjects") {
      if (probeMode === "timeout") await Bun.sleep(9000);
      if (probeMode === "invalid") return new Response("not a daemon response");
      if (probeMode === "health") return Response.json({ status: "ok" });
      if (emptyAgentCatalog) return Response.json({});
      return Response.json({projects:[{projectId:"p",name:"native"}],total:1});
    }
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
            error: failed ? "agent execution failed" : undefined,
            status: failed ? "RUN_STATUS_FAILED" : waiting
              ? "RUN_STATUS_RUNNING"
              : stops
                ? "RUN_STATUS_CANCELED"
                : "RUN_STATUS_SUCCEEDED",
          },
          output: failed ? failureOutput : waiting ? "" : "remote answer",
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
                events: failed ? [{ seq: 1, kind: "thinking", data: { Text: "Checking request" } }] : waiting
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
  test("connection test authenticates with a saved token without modifying saved nodes", async () => {
    const { testNodeConnection } = await import("./connection.ts");
    const { getNodes } = await import("./store.ts");
    const before = JSON.stringify(getNodes());
    const result = await testNodeConnection({ ...node, token: "" });
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result)).not.toContain("test-token");
    expect(JSON.stringify(getNodes())).toBe(before);
  });
  test("connection test distinguishes bad authentication, missing credentials and invalid URL", async () => {
    const { testNodeConnection } = await import("./connection.ts");
    expect(await testNodeConnection({ ...node, token: "wrong-token" })).toEqual({ ok: false, code: "unauthorized" });
    expect(await testNodeConnection({ name: "new", url: node.url, token: "" })).toEqual({ ok: false, code: "missing_token" });
    expect(await testNodeConnection({ ...node, url: "http://user:secret@localhost" })).toEqual({ ok: false, code: "invalid_url" });
    expect(await testNodeConnection({ ...node, url: "http://127.0.0.1:1" })).toEqual({ ok: false, code: "unreachable" });
  });
  test("connection test rejects malformed responses and unrelated health endpoints", async () => {
    const { testNodeConnection } = await import("./connection.ts");
    try {
      probeMode = "invalid";
      expect(await testNodeConnection(node)).toEqual({ ok: false, code: "invalid_response" });
      probeMode = "health";
      expect(await testNodeConnection(node)).toEqual({ ok: false, code: "invalid_response" });
    } finally { probeMode = "normal"; }
  });
  test("connection test times out rather than remaining pending", async () => {
    const { testNodeConnection } = await import("./connection.ts");
    try {
      probeMode = "timeout";
      expect(await testNodeConnection(node)).toEqual({ ok: false, code: "timeout" });
    } finally { probeMode = "normal"; }
  }, 12000);
  test("catalog does not expose native workspace or environment credentials", async () => {
    const {listAgents} = await import("./catalog.ts");
    const result=JSON.stringify(await listAgents());
    expect(result).not.toContain("workspace-secret");
    expect(result).not.toContain("env-secret");
  });
  test("model dropdown catalog includes native and enabled server models without provider secrets", async () => {
    const { listAgents, listModels } = await import("./catalog.ts");
    const { agents } = await listAgents();
    const result = await listModels(node.id, [...agents, { ...agents[0]!, nodeId: "other-server", model: "other-server-model" }]);
    expect(result.catalogUnavailable).toBe(false);
    expect(result.models).toEqual([
      { id: "remote-model", name: "Current model · GLM" },
      { id: "glm-5", name: "glm-5 · GLM" },
      { id: "model-b", name: "Model B · GLM" },
      { id: "vendor/model", name: "vendor/model · GLM" },
    ]);
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
  });
  test("older daemons preserve native model choices when the model catalog is unavailable", async () => {
    const { listAgents, listModels } = await import("./catalog.ts");
    modelCatalogUnavailable = true;
    try {
      const { agents } = await listAgents();
      const result = await listModels(node.id, agents);
      expect(result.catalogUnavailable).toBe(true);
      expect(result.models).toEqual([{ id: "remote-model", name: "remote-model" }]);
    } finally { modelCatalogUnavailable = false; }
  });
  test("creating an agent honors the enabled switch instead of always enabling it", async () => {
    const { createAgent } = await import("./catalog.ts");
    await createAgent({ nodeId: node.id, name: "Disabled agent", model: "remote-model", enabled: false, requestId: "disabled-create", dryRun: true });
    expect(patchedSpec.agents.at(-1).enabled).toBe(false);
  });
  test("the first agent is created without an existing remote agent when a Pi image is supplied", async () => {
    const { createAgent } = await import("./catalog.ts");
    emptyAgentCatalog = true;
    try {
      await expect(createAgent({ nodeId: node.id, name: "First agent", model: "glm-5", requestId: "first-agent", dryRun: true })).rejects.toThrow("Pi runtime image");
      await createAgent({ nodeId: node.id, name: "First agent", model: "glm-5", systemPrompt: "Drafted in Zo", image: "pi-runtime:test", requestId: "first-agent", dryRun: true });
      expect(appliedSpec.agents).toHaveLength(1);
      expect(appliedSpec.agents[0]).toMatchObject({ displayName: "First agent", model: "glm-5", provider: "pi", systemPrompt: "Drafted in Zo", image: "pi-runtime:test" });
    } finally { emptyAgentCatalog = false; }
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
  test("model billing failures emit a readable error and complete without streaming stderr", async () => {
    failed = true;
    waiting = false;
    stops = 0;
    const agent = backend("billing-failure");
    try {
      const events = [];
      for await (const event of agent.chat("hello")) events.push(event);
      expect(events.filter((event) => event.type === "text_delta" || event.type === "text_complete")).toHaveLength(0);
      expect(events.find((event) => event.type === "error")).toMatchObject({ message: "成员余额不足 (HTTP 402)" });
      expect(events.at(-1)?.type).toBe("complete");
      expect(readState(getSessionPath(root, "billing-failure"))?.turns.at(-1)?.status).toBe("RUN_STATUS_FAILED");
    } finally {
      failed = false;
      agent.destroy();
    }
  });
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

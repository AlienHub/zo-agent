import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = mkdtempSync(join(tmpdir(), "zo-remote-mcp-"));
process.env.CRAFT_CONFIG_DIR = root;
const { saveNode } = await import("./store.ts");
const { getAgentRemoteMcp, saveAgentRemoteMcp } = await import("./remote-mcp.ts");
const privateHeader = "private-header-do-not-return";
let rejected = false, patchCount = 0;
let project: any = {
  summary: { projectId: "project", name: "native", specHash: "v1" },
  agents: [{ agentName: "pi", provider: "pi", model: "glm", enabled: true }],
  spec: { name: "native", agents: [{ name: "pi", provider: "pi", model: "glm", env: [{ name: "KEY", value: "unrelated-secret" }], mcpServers: [{ name: "docs", type: "remote", transport: "http", url: "https://docs.test/mcp", headers: [{ name: "Authorization", value: privateHeader }] }] }] },
};
const daemon = Bun.serve({ port: 0, async fetch(req) {
  expect(req.headers.get("authorization")).toBe("Bearer daemon-secret");
  const body = await req.json() as any;
  if (req.url.endsWith("/GetProject")) return Response.json({ project });
  if (req.url.endsWith("/PatchProject")) {
    patchCount++;
    expect(body.expectedCurrentSpecHash).toBe(project.summary.specHash);
    if (rejected) return Response.json({ issues: [{ severity: "VALIDATION_SEVERITY_ERROR", message: privateHeader }] });
    project = { ...project, spec: body.spec, summary: { ...project.summary, specHash: "v" + (patchCount + 1) } };
    return Response.json({ applied: true });
  }
  return new Response("", { status: 404 });
}});
const node = saveNode({ name: "test", url: daemon.url.toString().replace(/\/$/, ""), token: "daemon-secret" });
const binding = { nodeId: node.id, projectId: "project", agentName: "pi" };
afterAll(() => { daemon.stop(true); rmSync(root, { recursive: true, force: true }); });
test("native round-trip masks credentials, preserves them on edits, and deletes only selected HTTP MCP", async () => {
  const loaded = await getAgentRemoteMcp(binding);
  expect(JSON.stringify(loaded)).not.toContain(privateHeader);
  expect(JSON.stringify(loaded)).not.toContain("unrelated-secret");
  expect(loaded.servers[0]!.headers).toEqual([{ name: "Authorization", hasValue: true }]);
  loaded.servers[0]!.url = "https://updated.test/mcp";
  const saved = await saveAgentRemoteMcp({ binding, ...loaded });
  expect(saved.specHash).toBe("v2");
  expect(project.spec.agents[0].mcpServers[0].headers[0].value).toBe(privateHeader);
  expect(JSON.stringify(saved)).not.toContain(privateHeader);
  expect(project.spec.agents[0].env[0].value).toBe("unrelated-secret");
  const count = patchCount;
  await expect(saveAgentRemoteMcp({ binding, ...loaded })).rejects.toThrow("configuration changed");
  expect(patchCount).toBe(count);
  const removed = await saveAgentRemoteMcp({ binding, specHash: saved.specHash, servers: [] });
  expect(removed.servers).toEqual([]);
});
test("upstream validation messages cannot leak submitted credentials", async () => {
  rejected = true;
  const config = await getAgentRemoteMcp(binding);
  try {
    await saveAgentRemoteMcp({ binding, specHash: config.specHash, servers: [{ name: "new", url: "https://new.test/mcp", headers: [{ name: "Authorization", value: privateHeader }] }] });
    throw new Error("Expected native validation rejection");
  } catch (e) {
    expect(String(e)).toContain("rejected the MCP configuration");
    expect(String(e)).not.toContain(privateHeader);
  }
});

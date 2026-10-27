import { describe, test, expect } from "bun:test";
import { buildRemoteMcpPatch, type RemoteMcpServer } from "./remote-mcp.ts";
import type { NativeProject } from "./catalog.ts";
const binding = { nodeId: "node", projectId: "project", agentName: "pi" };
const secret = "saved-private-token";
function fixture(): NativeProject {
  return {
    summary: { projectId: "project", name: "native", specHash: "v1" },
    agents: [{ agentName: "pi", provider: "pi", model: "glm", enabled: true }],
    spec: {
      name: "native", otherField: "preserved",
      mcpServers: [{ name: "shared", type: "remote", transport: "http", url: "https://shared.test/mcp", headers: [{ name: "Authorization", value: secret, secret: true }] }],
      agents: [{ name: "pi", model: "glm", workspace: { name: "source" }, env: [{ name: "KEY", value: "other-secret" }],
        mcpServers: [{ name: "shared" }, { name: "local", type: "local", command: "npx" }, { name: "legacy", type: "remote", transport: "sse", url: "https://old.test/sse" }] },
        { name: "other", model: "unchanged" }],
    },
  };
}
const server = (): RemoteMcpServer => ({ originalName: "shared", name: "shared", url: "https://new.test/mcp", headers: [{ name: "Authorization" }] });
const patch = (servers = [server()], project = fixture(), specHash = "v1") => buildRemoteMcpPatch(project, { binding, specHash, servers });
describe("native remote HTTP MCP patches", () => {
  test("preserves saved headers, other agent fields, local/SSE servers, shared definition and other agents", () => {
    const p = fixture(), before = JSON.stringify(p), result = patch([server()], p);
    expect(JSON.stringify(p)).toBe(before);
    expect(result.otherField).toBe("preserved");
    expect(result.agents[1]).toEqual(p.spec.agents[1]);
    expect(result.agents[0].env).toEqual(p.spec.agents[0].env);
    expect(result.agents[0].workspace).toEqual(p.spec.agents[0].workspace);
    expect(result.mcpServers).toEqual(p.spec.mcpServers);
    expect(result.agents[0].mcpServers).toEqual([
      p.spec.agents[0].mcpServers[1], p.spec.agents[0].mcpServers[2],
      { ...p.spec.mcpServers[0], url: "https://new.test/mcp" },
    ]);
  });
  test("renames a service without losing credentials and permits key rotation", () => {
    const s = server(); s.name = "renamed";
    expect(patch([s]).agents[0].mcpServers.at(-1).headers[0].value).toBe(secret);
    expect(patch([{ ...s, headers: [{ name: "Authorization", value: "new-token" }] }]).agents[0].mcpServers.at(-1).headers[0]).toEqual({ name: "Authorization", value: "new-token", secret: true });
  });
  test("removing header or HTTP service preserves unmanaged services", () => {
    expect(patch([{ ...server(), headers: [] }]).agents[0].mcpServers.at(-1).headers).toEqual([]);
    expect(patch([]).agents[0].mcpServers.map((m: any) => m.name)).toEqual(["local", "legacy"]);
  });
  test("preserves native redaction markers only at the same server and header identity", () => {
    const p = fixture();
    p.spec.mcpServers[0].headers[0].value = "********";
    expect(patch([server()], p).agents[0].mcpServers.at(-1).headers[0].value).toBe("********");
    expect(() => patch([{ ...server(), name: "renamed" }], p)).toThrow("mcp_secret_value_required");
    expect(() => patch([{ ...server(), headers: [{ name: "authorization" }] }], p)).toThrow("mcp_secret_value_required");
    expect(() => patch([{ ...server(), headers: [{ name: "Authorization", value: "********" }] }], p)).toThrow("mcp_secret_value_required");
    expect(patch([{ ...server(), name: "renamed", headers: [{ name: "Authorization", value: "new-secret" }] }], p)
      .agents[0].mcpServers.at(-1).headers[0].value).toBe("new-secret");
    p.spec.mcpServers[0].env = [{ name: "TOKEN", value: "********", secret: true }];
    expect(() => patch([{ ...server(), name: "renamed", headers: [] }], p)).toThrow("mcp_secret_value_required");
  });
  test("rejects stale edits and active runs", () => {
    expect(() => patch([server()], fixture(), "stale")).toThrow("configuration changed");
    const p = fixture(); p.agents[0]!.currentRun = { runningRunCount: 1 };
    expect(() => patch([server()], p)).toThrow("Stop active runs");
  });
  test("rejects invalid/duplicate identities and references to another service's credentials", () => {
    for (const name of ["Invalid Name", "local", "../escape", ""]) expect(() => patch([{ ...server(), name }])).toThrow();
    expect(() => patch([server(), server()])).toThrow();
    expect(() => patch([{ ...server(), originalName: "not-yours" }])).toThrow();
  });
  test("rejects bad URLs and header injection, without exposing submitted values", () => {
    for (const url of ["file:///secret", "https://user:password@host/mcp", "javascript:alert(1)", "https://x/mcp#fragment"]) expect(() => patch([{ ...server(), url }])).toThrow();
    for (const headers of [[{ name: "Bad Name", value: "x" }], [{ name: "X-Key", value: "token\r\nInjected: true" }], [{ name: "X-Key", value: "x" }, { name: "x-key", value: "y" }], [{ name: "New-Key" }]]) {
      expect(() => patch([{ ...server(), headers }])).toThrow();
    }
  });
});

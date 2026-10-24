import { afterAll, describe, expect, test } from "bun:test";
import { listImages } from "./images";
import type { ComposeAgent } from "./types";

let mode = "catalog";
const requests: unknown[] = [];
const daemon = Bun.serve({ port: 0, async fetch(request) {
  expect(new URL(request.url).pathname).toBe("/agentcompose.v2.ImageService/ListImages");
  expect(request.headers.get("authorization")).toBe("Bearer image-test-token");
  const body = await request.json() as { offset: number };
  requests.push(body);
  if (mode === "unsupported") return new Response("", { status: 404 });
  if (mode === "empty") return Response.json({});
  if (mode === "unavailable") return Response.json({ storeStatus: { available: false, error: "private backend path" } });
  return Response.json({
    images: body.offset ? [{ imageRef: "untagged", repoDigests: ["registry/pi@sha256:abc"] }] : [
      { repoTags: ["registry/pi:v1", "registry/pi:latest", "registry/pi:v1"], labels: { secret: "not-public" }, platform: { os: "linux", architecture: "arm64" } },
      { dangling: true, imageRef: "sha256:old", repoTags: ["<none>:<none>"] },
    ], total: 3, storeStatus: { available: true },
  });
} });
afterAll(() => daemon.stop(true));
const node = { id: "one", name: "Test", url: `http://127.0.0.1:${daemon.port}`, token: "image-test-token" };
const agents = [
  { nodeId: "one", provider: "pi", spec: { image: "registry/pi:v1" } },
  { nodeId: "one", provider: "pi", spec: { image: "registry/offline:v2" } },
  { nodeId: "other", provider: "pi", spec: { image: "other-server-only" } },
  { nodeId: "one", provider: "codex", spec: { image: "codex-only" } },
].map((agent) => ({ projectId: "project", agentName: "agent", name: "Agent", model: "model", enabled: true, specHash: "hash", ...agent })) satisfies ComposeAgent[];

describe("native runtime image discovery", () => {
  test("paginates, deduplicates tags, prioritizes Pi configuration and exposes no labels or credentials", async () => {
    mode = "catalog"; requests.length = 0;
    const result = await listImages(node, agents);
    expect(requests).toEqual([{ offset: 0, limit: 500 }, { offset: 2, limit: 500 }]);
    expect(result.imagesUnavailable).toBe(false);
    expect(result.images).toEqual([
      { ref: "registry/offline:v2", local: false, usedByPi: true },
      { ref: "registry/pi:v1", local: true, usedByPi: true, platform: "linux/arm64" },
      { ref: "registry/pi:latest", local: true, usedByPi: false, platform: "linux/arm64" },
      { ref: "registry/pi@sha256:abc", local: true, usedByPi: false, platform: undefined },
    ].sort((a, b) => Number(b.usedByPi) - Number(a.usedByPi) || a.ref.localeCompare(b.ref)));
    expect(JSON.stringify(result)).not.toMatch(/not-public|image-test-token|other-server-only|codex-only|<none>/);
  });
  test("older daemons keep existing Pi image references without claiming they are local", async () => {
    mode = "unsupported";
    const result = await listImages(node, agents);
    expect(result.imagesUnavailable).toBe(true);
    expect(result.images).toHaveLength(2);
    expect(result.images.every((image) => !image.local && image.usedByPi)).toBe(true);
  });
  test("empty server and unavailable store have distinct results", async () => {
    mode = "empty";
    expect(await listImages(node, [])).toEqual({ images: [], imagesUnavailable: false });
    mode = "unavailable";
    expect(await listImages(node, [])).toEqual({ images: [], imagesUnavailable: true });
  });
});

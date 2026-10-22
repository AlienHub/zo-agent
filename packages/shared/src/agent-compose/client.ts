import type { ComposeNode } from "./types.ts";

/** Connect JSON client; credentials never travel to a renderer. */
export class ComposeClient {
  constructor(readonly node: ComposeNode) {}
  async call<T>(
    service: string,
    method: string,
    body: unknown,
    signal?: AbortSignal,
    timeout = 20_000,
  ): Promise<T> {
    const res = await fetch(
      `${this.node.url.replace(/\/$/, "")}/agentcompose.v2.${service}/${method}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "connect-protocol-version": "1",
          authorization: `Bearer ${this.node.token}`,
        },
        body: JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
          : AbortSignal.timeout(timeout),
      },
    );
    if (!res.ok) throw new ComposeRpcError(method, res.status);
    return (await res.json()) as T;
  }
  async exec(sandboxId: string, code: string, args: string[] = []) {
    const { result } = await this.call<{
      result: { exitCode?: number; stdout: string; stderr?: string };
    }>("ExecService", "Exec", {
      sandboxId,
      command: { command: "python3", args: ["-c", code, ...args] },
      cwd: "/workspace",
      timeoutMs: 5000,
      maxOutputBytes: 12 << 20,
    });
    if (result.exitCode) throw new Error("Sandbox operation failed");
    return result.stdout;
  }
  async *follow(
    runId: string,
    offset: number,
    signal: AbortSignal,
  ): AsyncGenerator<{ data: string; offset: number }> {
    const body = new TextEncoder().encode(
      JSON.stringify({
        runId,
        startOffset: String(offset),
        follow: true,
        includeMetadata: true,
      }),
    );
    const frame = new Uint8Array(body.length + 5);
    new DataView(frame.buffer).setUint32(1, body.length);
    frame.set(body, 5);
    const res = await fetch(
      `${this.node.url}/agentcompose.v2.RunService/FollowRunLogs`,
      {
        method: "POST",
        headers: {
          "content-type": "application/connect+json",
          "connect-protocol-version": "1",
          authorization: `Bearer ${this.node.token}`,
        },
        body: frame,
        signal,
      },
    );
    if (!res.ok || !res.body)
      throw new ComposeRpcError("FollowRunLogs", res.status);
    const reader = res.body.getReader();
    let pending = new Uint8Array(0);
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const combined = new Uint8Array(pending.length + chunk.value.length);
        combined.set(pending);
        combined.set(chunk.value, pending.length);
        pending = combined;
        while (pending.length >= 5) {
          const flags = pending[0]!,
            size = new DataView(
              pending.buffer,
              pending.byteOffset,
              pending.byteLength,
            ).getUint32(1);
          if (size > 4 << 20)
            throw new Error("agent-compose log frame exceeds limit");
          if (pending.length < size + 5) break;
          const message = JSON.parse(
            new TextDecoder().decode(pending.subarray(5, size + 5)),
          );
          pending = pending.slice(size + 5);
          if (flags & 2) {
            if (message.error)
              throw new Error("agent-compose log stream interrupted");
            return;
          }
          if (flags) throw new Error("Unsupported agent-compose stream frame");
          if (message.data)
            yield { data: message.data, offset: Number(message.offset) };
          if (message.isFinal) return;
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
export class ComposeRpcError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
  ) {
    super(`agent-compose ${method}: HTTP ${status}`);
  }
}
export const terminal = (status: string) =>
  ["RUN_STATUS_SUCCEEDED", "RUN_STATUS_FAILED", "RUN_STATUS_CANCELED"].includes(
    status,
  );

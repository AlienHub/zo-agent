# Spike-0: Built-in Tool Output Redaction Boundary

Date: 2026-06-18

## Question

Can Zo rewrite built-in `Read` / `Bash` tool output before it enters model context?

## Finding

Coverage differs by backend and tool path:

| Path | Can rewrite before model context? | Evidence |
|---|---:|---|
| MCP/API source tools | Yes | `McpClientPool.callTool()` wraps results with `guardToolResult()` before returning content. |
| Session tools (`transform_data`, `script_sandbox`, etc.) | Yes | Claude and Pi session tool adapters wrap `SESSION_TOOL_REGISTRY` handler results before returning content. |
| Pi built-in tools | Yes | `packages/pi-agent-server/src/index.ts` wraps Pi tool definitions and calls `guardToolResult()` before yielding tool results. |
| Claude SDK built-in `Read` / `Bash` | No reliable rewrite hook | `claude-agent.ts` notes PostToolUse rewriting was removed because `updatedMCPToolOutput` is not a valid SDK output field. |

## Product Decision

For the personal edition, Claude SDK built-in tool output redaction remains a known boundary. The reliable control for Claude built-ins is FR-1 pre-tool path blocking, especially for `.env`, private keys, cloud credentials, kube config, npm tokens, and similar high-risk paths.

When users need structured-file redaction guarantees, prefer session tools or MCP/source paths that pass through `ToolResultGuard`. The UI and docs must not claim runtime DLP or full resistance to active bypasses.

## Release Gate

- Keep FR-1 credential path blocking enabled by default.
- Keep the "not resistant to active bypass / runtime DLP" boundary in product copy.
- Keep eval coverage for transform/session/MCP redaction and for sensitive path blocking.
- Do not mark Claude built-in `Read` / `Bash` output redaction as fully covered unless the SDK exposes a supported output-rewrite hook or Zo replaces those built-ins with self-hosted equivalents.

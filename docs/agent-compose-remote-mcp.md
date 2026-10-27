# Remote MCP for native Agent Compose agents

Open **Settings → Agent Compose**, then **MCP** on an agent row. Add a name,
Streamable HTTP URL, and optional authentication headers. Save writes directly
to the native agent's `mcpServers` through `ProjectService/PatchProject`.
There is no separate Zo MCP registry for these agents.

- URLs must be reachable from the sandbox. `localhost` means the sandbox itself.
- Only remote HTTP entries are edited. Existing local/SSE entries remain intact.
- Editing a project-level reference creates an agent-local override; other agents
  and the shared project definition are preserved.
- Saved header values never enter the renderer. Leave a saved value blank to
  retain it, type a replacement to rotate it, or remove its row to delete it.
- Stop active runs before saving. Concurrent project edits are rejected using the
  native spec hash; close and reopen the dialog to load the current definition.
- Existing runtime environments may require a new session to pick up changes.

## Affected older Pi guest images

For the versioned Zo execution environment, see
[`guest-images/README.md`](../guest-images/README.md). It pins the upstream image
and runtime package versions and includes the adapter check below. The compatibility
Dockerfile remains a separate repair path for other upstream versions.

The locally installed `chaitin/agent-compose-guest:latest` tested on 2026-10-24
contained only `index.ts` at `/usr/local/share/agent-compose/pi-mcp-adapter`,
while the full adapter package existed at `/usr/lib/node_modules/pi-mcp-adapter`.
Pi failed to load that extension because sibling modules were missing.
Saving MCP configuration alone cannot fix this image defect.

The same failure can also report `Unknown option: --mcp-config`. That flag is
registered by the MCP extension. If the extension cannot import `./commands.ts`,
Pi never learns the flag. Removing the flag or starting with `pi -ne` disables
the intended integration rather than repairing it.

`guest-images/Dockerfile.pi-mcp-compat` supplies a narrow compatibility image:
it links to the complete, already-installed adapter package without upgrading Pi.
Build on the host running Agent Compose, preferably against the affected image's
immutable digest, then explicitly choose the new image for an agent:

```sh
docker build --pull=false --network=none \
  --build-arg BASE_IMAGE=chaitin/agent-compose-guest:latest \
  -f guest-images/Dockerfile.pi-mcp-compat \
  -t zo-agent-guest:remote-mcp-compat .
```

This does not replace or retag the original image, or migrate existing agents.
Guests missing the full adapter package fail the build rather than produce a
partially working image. Newer upstream images may not need this workaround.

Use the image tag actually configured on the affected server (for example
`chaitin/agent-compose-guest:v2610.2.0`) instead of assuming its `latest` tag is
the same build. The compatibility image must be built or loaded on that server's
Docker host, using its CPU architecture; a locally built image on a Mac does not
automatically appear on a remote Linux server.

The Dockerfile checks both the complete adapter layout and registration of the
`--mcp-config` option. A successful `pi --help` exit alone is not a sufficient
check. After explicitly selecting the compatibility image for the agent, use a
new sandbox/session to validate it; existing containers keep their original
filesystem and image. Preserve existing sessions and workspace data.

## Validation

Unit and isolated RPC tests cover native field preservation, shared references,
masked credentials, rotation/removal, optimistic concurrency and validation.

An isolated native daemon, Zo server and Dev client also verified UI add/save/
reopen/remove and a real Pi model turn calling a bearer-authenticated remote HTTP
MCP tool. The fixture recorded `tools/call`, and Pi returned the tool's unique
marker. Production daemon, agents and main development checkout were untouched.

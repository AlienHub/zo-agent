# Agent Compose in Zo

Zo 0.2.0 integrates Agent Compose through TypeScript. The desktop application can run its embedded server or connect to a standalone Zo server. No Go adapter process is required.

## Connect

1. Open Zo. On a fresh installation, choose **Setup later** if local model credentials are not needed.
2. Open **Settings → Agent Compose → Connect**.
3. Enter the daemon HTTP(S) endpoint and its existing bearer token. This is the daemon API URL, not its admin UI URL.
4. Refresh agents. Enabled native Pi agents appear in Zo's existing connection/model selector.
5. Start a conversation and select the agent before sending the first message. Subsequent messages retain that binding and sandbox.

Agent Compose projects remain transport identities. Zo does not create a project or agent per conversation. Create, edit, disable and delete operate on native project specs, preserve sibling agents and use spec hashes to reject stale writes. Existing Pi runtime settings are inherited when creating an agent. An empty server needs a compatible Pi image and model configured on its daemon.

The agent editor merges each enabled provider's declared `models` with automatically discovered `capabilities.models`. Options save the native opaque model ID unchanged (including any slash that is part of the actual ID). Provider names are display labels; Agent Compose owns provider routing. Identical model IDs are merged rather than inventing a `providerId/modelId` value. Existing agent model references remain selectable even if discovery is unavailable. Provider credentials and headers never travel to the renderer. Saving changes the native agent's shared default; it does not override a single session or change the daemon-wide default.

The local daemon at revision `3d602e46` needs the compatibility patch in `patches/agent-compose-model-discovery.patch`: model inventory reads refresh after the protocol cache expires, use bounded GET requests and propagate cancellation without running inference. Complete chat endpoints such as `/api/coding/paas/v4/chat/completions` are respected when deriving `/models`. The patch is applied to the system daemon source; it changes no database schema, guest image or sandbox lifecycle. Reapply it when rebuilding this daemon revision, or remove it once upstream includes equivalent fixes.

The remote agent currently owns its model and runtime permissions. Change its model in the Agent Compose section; Zo reads the effective model before submitting a run. This adapter supports Pi agents. Other native agent types can be listed and managed but are not presented as compatible chat connections.

The native image picker reads `ImageService/ListImages` from the selected server and retains image references already configured on its Pi agents. Images already used by Pi are listed first; the image catalog does not verify Pi compatibility. Custom references remain available for registries, empty inventories and older daemons. Refresh images after pulling or building an image on the server. Image labels and registry metadata stay server-side. Saving an edited image updates that native agent’s shared runtime configuration.

## Execution settings

Compose conversations use the native agent's server-side model, prompt, runtime, tools and permissions. Zo hides local permission modes, working-directory selection, Coding mode, local source/skill pickers, local slash-command menus, manual compaction and background-command shortcuts. Attachments, sandbox file browsing, status/labels and ordinary chat display remain available. The sandbox header links to the native agent settings.

Local performance, permissions, workspace execution defaults and personal preferences are marked as local settings; they are not synchronized into Compose agents. AI defaults and workspace overrides show the remote model and a management link instead of local model/thinking editors when a Compose connection is selected. Existing saved local settings remain intact for local sessions. Unsupported remote-session mutations fail before persistence, including a missing connection with a retained sandbox identity. Old local source metadata on remote sessions is ignored rather than initializing local MCP integrations.

## Draft an agent with Zo

The creation dialog places the requirements and drafting connection on the left and the editable native configuration on the right. Narrow windows stack the panels and keep Save reachable.

In **Settings → Agent Compose → Create agent**, describe its purpose and choose **Draft with Zo**. Drafting uses an authenticated native Zo AI connection (workspace/global default preferred). Compose-bound connections are excluded. When multiple Zo connections are available, choose the drafting connection separately from the target agent model. Without a signed-in Zo connection, the form links to AI settings and still permits manual configuration.

Drafts run as hidden Zo sessions in Explore mode, without a project directory or enabled sources. Stop uses the ordinary session cancellation path; reconnect reloads the persisted result. Only the generated name, description and system prompt are copied into the preview. The target daemon, model, runtime image and enabled switch remain user choices. Nothing is deployed until **Save**. A daemon with no existing Pi agents can receive the first agent when a compatible Pi runtime image is supplied; drafting itself does not contact the daemon.

## Remote desktop

Use the workspace switcher → Add workspace → Connect to server. Enter the Zo WebSocket server URL and token, then select the server workspace. Agent Compose settings for that workspace are executed on that Zo server. The desktop does not need the daemon token.

For a dedicated thin-client launch, `CRAFT_SERVER_URL` and `CRAFT_SERVER_TOKEN` select the remote Zo server. The server's actual workspace ID is discovered before opening the first window.

## Standalone server

Build with `bun run server:build:darwin-arm64` (or `server:build:linux-x64` / `server:build:linux-arm64`). Extract the generated archive and run its `start.sh` with `CRAFT_SERVER_TOKEN` set. State lives under `CRAFT_CONFIG_DIR` when specified; use a persistent private directory and back it up.

The server defaults to loopback port 9100. Set `CRAFT_RPC_HOST=0.0.0.0` to listen on the network. For a network deployment configure `CRAFT_RPC_TLS_CERT` and `CRAFT_RPC_TLS_KEY`. The explicit `--allow-insecure-bind` option is available for a trusted development LAN. `CRAFT_WEBUI_DIR` can point to `apps/webui/dist` from `bun run webui:build` to enable the browser client on the same port.

## Conversation and sandbox behavior

- Streaming text, tool inputs/results and native Pi thinking use Zo's existing transcript and expandable activity controls.
- Refreshing or quitting a client detaches observation; it does not stop the remote run.
- Stop persists intent before contacting the daemon and waits for terminal remote status. Offline stop is retried when connectivity returns.
- A server restart resumes observation from durable state and the native Pi journal. Completed responses are acknowledged only after the Zo transcript is flushed.
- Idempotent submission keys prevent an ambiguous network response from starting a second run.
- MOUNT workspaces share an execution lease across conversations on one Zo server. Isolated sandbox workspaces may run concurrently.
- **Sandbox files** in the chat header browses `/workspace` inside the session's actual sandbox. Browsing is read-only; use the agent to modify files. Symlink escapes are rejected. Text previews are limited to 1 MiB, image/PDF previews to 8 MiB.
- Up to 20 attachments of 10 MiB each are staged privately on the Zo server and uploaded into `/workspace/.zo-attachments/<session>/<turn>/`. They are ordinary files in that workspace; they are hidden from the browsing tree. Shared MOUNT workspaces retain them in the mounted directory.
- Node credentials stay on the Zo server in a private configuration file and are never included in the public catalog or installer.

## Local build

`bun run app:package:mac` builds a macOS Apple Silicon DMG without credential synchronization or publishing. It verifies the signed application before creating the image and clears its staging directory between runs. Local builds use ad-hoc signing and are not Apple-notarized.

Validation includes TypeScript checks, native create/edit/delete and stale-write rejection, actual Pi tools and file preview, first-message attachments, SIGKILL and graceful server restart, client reconnect/history, stop and subsequent continuation. Browser-only component tests require an appropriate DOM/CSS harness; a blanket Bun run also shares module mocks across files, so affected failures must be checked in isolation.


## SSH tunnel connections

In Settings → Agent Compose → Connect, select **SSH tunnel**. Enter a host name or alias from the Zo server machine's `~/.ssh/config`, the Daemon URL as reachable from that SSH host (for example `http://127.0.0.1:43285`), and the Daemon Token. Host suggestions include literal aliases from SSH config and its Include files. Existing direct connections keep their current behavior.

Zo invokes the system OpenSSH client without a shell and reuses SSH config, keys, ssh-agent and jump hosts. Encrypted keys must already be unlocked in the agent. New or changed host keys require verification in a terminal first; the app never accepts them automatically. SSH prompts are noninteractive and authentication errors are shown in connection testing.

The tunnel binds an automatically allocated loopback port. JSON RPC, sandbox file operations and streaming logs all use it. HTTPS connections retain the remote SNI, certificate checks and Host header. A dropped SSH process reconnects with bounded exponential backoff; requests are not replayed by the tunnel layer. Existing run IDs and transcript offsets remain owned by the durable Agent Compose adapter.

Tunnels belong to the **Zo server process**. For a thin desktop client connected to a remote Zo server, SSH config and keys must be available on that server. Closing a connection, changing its destination or shutting down Zo closes the owned tunnel. A pipe watchdog also terminates SSH if the owning process exits abruptly.

## macOS update recovery

The public macOS packages use ad hoc signatures. These signatures change per build, so they cannot satisfy Squirrel.Mac’s requirement for a stable signing identity. The automatic installer for these packages uses a detached bundle handoff instead; Developer ID builds continue to use the native installer.

Before quitting, Zo checks the exact ZIP’s release-manifest SHA-512, archive paths, bundle identity/version, CPU architecture and code integrity, and starts a helper that acknowledges readiness. It flushes sessions and saves window state before explicitly exiting. The helper waits for that PID to exit, swaps bundles on the same filesystem, launches the replacement, and retains the old bundle until the new app confirms initialization and window loading. Failed startup restores and relaunches the previous version. Quit timeouts leave the installed app unchanged. User configuration is outside the app bundle and is never replaced. The helper does not change signing, quarantine attributes or macOS security settings.

Installer diagnostics are written to `mac-update-install.log` in Electron’s logs directory. A rollback is also reported in the relaunched client’s update state; automatic launch checking skips that failed handoff, while a manual check permits retrying. Invalid downloads fail while the existing app is still operational. Signed builds only show “Restart to update” after the native installer confirms readiness, rather than from a cache file or version metadata.

**Bootstrap for affected clients:** already distributed 0.2.0/0.2.1 apps contain the broken installer. They require one manual replacement with a build containing this fix; installing a new release cannot retroactively change the old updater. Keep `~/.craft-agent` (or the configured `CRAFT_CONFIG_DIR`) when replacing the app.

To run the isolated macOS upgrade test:

```sh
ZO_TEST_MAC_UPDATER=1 bun test ./apps/electron/src/main/__tests__/mac-update.integration.test.ts
```

It builds private Electron bundle copies, serves a local update feed, and exercises download, verification, replacement, relaunch, rollback, process timeout and unchanged session data. It never modifies `/Applications/Zo.app`.

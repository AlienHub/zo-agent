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

## Draft an agent with Zo

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

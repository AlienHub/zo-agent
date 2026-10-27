# Zo Agent Runtime — Pi Slim

`zo-agent-runtime:0.1.0-pi-slim` provides the Pi execution environment for native
Agent Compose agents. Agent Compose owns sandbox lifecycle and session persistence;
the image supplies the tools. It does not contain the Zo App or service.

## Contents and image size

The build starts from a pinned official guest only as an extraction stage. It
removes other agent CLIs, their optional native executables, Jupyter and build
toolchains, then copies the retained filesystem into a fresh `scratch` stage.
Deleting files in a child layer alone would retain the original image's large
layers; flattening prevents those bytes entering the distributed image.

The retained Debian environment includes Node.js/npm, Python/packaged pip, Git,
Bash, curl and tini. `runtime-lock.json` records the tested Node, Agent Compose
Runtime, Pi and MCP adapter versions. The full MCP adapter directory is linked at
the path expected by the upstream runtime. Guest ABI metadata advertises Pi only.
This profile supports Pi chat, tools and session recovery; choose another image
when an agent needs a different provider, Jupyter or a native build toolchain.

The validated Linux AMD64 build is approximately **773 MB**, compared with
**4.42 GB** for its source guest (Docker's expanded image sizes, about 82.5% less).
Registry download sizes depend on compression and shared layers. The AMD64 build
passed native Agent Compose command execution, sandbox stop/resume and workspace
preservation, in addition to the loopback Pi/MCP checks described below.

Agent names, prompts, models, MCP endpoints and credentials remain native Agent
Compose configuration. Workspace files remain mounted data. None is copied into
the image. The build context is this directory, not the application checkout.

## Build and verify

On the Docker host used by Agent Compose:

```sh
docker build --pull=false --network=none \
  -f guest-images/Dockerfile.zo-runtime \
  -t zo-agent-runtime:0.1.0-pi-slim guest-images
bash guest-images/test-runtime.sh zo-agent-runtime:0.1.0-pi-slim
```

Build steps need no package registry or Debian mirror. The pinned source image
must already be cached or downloadable; registry image resolution is outside
`--network=none`. Builders initially need the full upstream guest, while consumers
pull only the resulting slim image. Source provenance remains in the image label.

The source guest has Linux AMD64 and ARM64 variants. Build and verify each target
natively before publishing a multi-platform image; a successful AMD64 test does
not establish ARM64 compatibility. Image versions are independent of App versions.
Do not overwrite a published release tag.

## Checks

`zo-runtime-check` verifies package versions, the Pi-only guest ABI, retained CLI
tools, adapter imports and registration of `--mcp-config`. Missing modules or a
version mismatch fail the build.

`smoke-pi.mjs` runs the real upstream Pi runner with loopback HTTP fixtures. It
checks an authenticated MCP tool call, persisted session history, cancellation of
a pending model stream and resuming that session after stopping. It uses no real
model credentials or inference service. It runs during the Docker build too.

The host smoke script verifies default container startup, graceful stop/restart,
and recreating a container with the same workspace volume. It creates and removes
only its own temporary container and volume. These fixtures do not verify a real
provider's availability or the authentication of a user's MCP service.

## Rollout and rollback

After verification, explicitly select the new image on an agent. This changes its
shared runtime configuration, so check for active runs first and use the native
spec hash to reject concurrent edits. New sandboxes use the selected image;
existing sandboxes retain their original image and filesystems. Preserve their
workspaces and history. Roll back by selecting the previous image reference.

`Dockerfile.pi-mcp-compat` remains a separate narrow repair for other upstream
versions. It preserves their installed runtimes and does not reduce image size.

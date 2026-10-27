#!/usr/bin/env bash
set -euo pipefail
image="${1:?Usage: test-runtime.sh IMAGE}"
container="zo-runtime-test-$(date +%s)-$$"
volume="${container}-workspace"
marker="${container}-persisted"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker volume create "$volume" >/dev/null

# Use the inherited tini/env entrypoint, an isolated network, and a fresh volume.
# Only this script's own container and volume are removed.
docker run -d --name "$container" --network none \
  --mount "type=volume,source=$volume,target=/workspace" "$image" >/dev/null
docker exec "$container" zo-runtime-check
docker exec "$container" node /usr/local/share/zo-runtime/smoke-pi.mjs
docker exec "$container" sh -c 'test "$PWD" = /workspace; printf "%s" "$1" > /workspace/zo-smoke-marker' sh "$marker"
docker stop -t 5 "$container" >/dev/null
case "$(docker inspect -f '{{.State.ExitCode}}' "$container")" in
  0|143) ;;
  *) echo 'Runtime did not stop cleanly' >&2; exit 1 ;;
esac
docker start "$container" >/dev/null
test "$(docker exec "$container" cat /workspace/zo-smoke-marker)" = "$marker"
docker rm -f "$container" >/dev/null

# Recreating the runtime must preserve mounted workspace data as well.
docker run --rm --network none \
  --mount "type=volume,source=$volume,target=/workspace" \
  "$image" sh -c 'test "$(cat /workspace/zo-smoke-marker)" = "$1"' sh "$marker"
echo 'Runtime startup, graceful stop, restart, and workspace persistence passed.'

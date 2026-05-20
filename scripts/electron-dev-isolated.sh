#!/usr/bin/env bash
set -euo pipefail

DEV_ROOT="${CRAFT_DEV_ROOT:-/tmp/craft-agents-dev}"
DEV_PORT="${CRAFT_DEV_PORT:-5273}"
DEV_APP_NAME="${CRAFT_DEV_APP_NAME:-Craft Agents Dev}"
DEV_SCHEME="${CRAFT_DEV_DEEPLINK_SCHEME:-craftagentsdev}"

mkdir -p \
  "$DEV_ROOT/home" \
  "$DEV_ROOT/config" \
  "$DEV_ROOT/user-data"

echo "Starting isolated Electron dev environment"
echo "  root:        $DEV_ROOT"
echo "  HOME:        $DEV_ROOT/home"
echo "  config:      $DEV_ROOT/config"
echo "  user data:   $DEV_ROOT/user-data"
echo "  vite port:   $DEV_PORT"
echo "  app name:    $DEV_APP_NAME"
echo "  deeplink:    $DEV_SCHEME"

export HOME="$DEV_ROOT/home"
export CRAFT_CONFIG_DIR="$DEV_ROOT/config"
export CRAFT_VITE_PORT="$DEV_PORT"
export CRAFT_APP_NAME="$DEV_APP_NAME"
export CRAFT_DEEPLINK_SCHEME="$DEV_SCHEME"
export CRAFT_INSTANCE_NUMBER="${CRAFT_DEV_INSTANCE_NUMBER:-dev}"
export ELECTRON_USER_DATA_DIR="$DEV_ROOT/user-data"

exec bun run scripts/electron-dev.ts "$@"

# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

- **Agent Compose over SSH** Connect through existing OpenSSH host aliases and keys, automatically reconnect dropped tunnels, and test SSH authentication directly in settings.

## Improvements

- **Agent creation** Describe requirements beside an editable configuration preview, and choose runtime images discovered from the selected Agent Compose server.

## Bug Fixes

- **Remote execution settings** Agent Compose chats expose sandbox capabilities instead of local tools, folders and permission controls; settings clarify their scope and unsupported remote changes are rejected before persistence.

## Breaking Changes

- None.

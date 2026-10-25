# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits. The in-app loader only reads `X.Y.Z.md` files, so this file is never shown to users.

## Features

- None.

## Improvements

- None.

## Bug Fixes

- **macOS update installation** Restore automatic macOS updates for ad hoc releases. Verify the downloaded ZIP, application identity, version, CPU and code integrity before quitting; retain the previous app until the new version confirms startup and roll back if startup fails. Signed builds wait for native installer readiness. Cached metadata no longer marks an update ready, and check failures no longer appear as “up to date”.

## Breaking Changes

- None.

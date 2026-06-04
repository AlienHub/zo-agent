# Release Workflow

This fork uses its own app version for packaged desktop releases. Upstream Craft Agents version information is tracked separately in `upstream-version.json`.

## Version Model

- `package.json` versions are the distributable app version used by Electron auto-update.
- `upstream-version.json` records the upstream repository version and commit this fork is based on.
- App releases are created from Git tags like `v0.1.0`.

## Release Steps

1. Update all package versions to the target version.
2. Run `bun run release v0.1.0`.
3. Commit the release changes.
4. Create and push the tag:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

The `Release Electron` workflow builds macOS, Windows, and Linux packages, then publishes them to the GitHub Release for the tag. The Electron builder config uses `releaseType: release` so published assets are available to auto-update and `releases/latest/download`.

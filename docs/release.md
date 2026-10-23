# Release Workflow

Zo desktop releases use the version in workspace package manifests. Upstream Craft Agents information is tracked separately in `upstream-version.json`.

1. Align workspace package versions and `bun.lock` with the release version.
2. Add curated notes in `apps/electron/resources/release-notes/<version>.md`.
3. Run `bun run scripts/verify-release-version.ts v0.2.0` and the relevant checks.
4. Run `bun run app:package:mac` on macOS Apple Silicon. This builds the app, verifies its ad hoc signature and DMG, and produces the update ZIP and `latest-mac.yml`.
5. Smoke-test the built app using a separate configuration directory.
6. Commit and push the release commit, then publish the verified assets to `AlienHub/zo-agent` under the matching version tag.

The tag-triggered `Release Electron` workflow also builds and publishes macOS arm64 artifacts. Windows, Linux and Intel Mac installers are not currently built by this workflow. The current macOS packaging script uses ad hoc signing; it does not perform Apple notarization.

`latest-mac.yml` and its referenced ZIP must be published together for Electron auto-update. A DMG alone supports manual installation only.

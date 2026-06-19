# CLAUDE.md — repo root

Monorepo for the Zo / Craft Agent Electron app. Per-package guidance lives in
each package's own `CLAUDE.md` (e.g. `packages/shared/CLAUDE.md`,
`packages/core/CLAUDE.md`). This file documents repo-wide conventions.

## Releasing

Releases are cut by pushing a **`v*.*.*` tag**, which triggers
`.github/workflows/release-electron.yml` (build + publish for mac/win/linux).
Pushing `main` only runs validation (`validate.yml`).

**Every release MUST:**

1. **Bump the version in ALL package.json files to match the tag.** The release
   CI runs `scripts/verify-release-version.ts <tag>`, which fails the build if
   *any* versioned `package.json` (except `apps/online-docs/`) differs from the
   tag's `X.Y.Z`. The repo uses a single synchronized version across every
   workspace. Bump them together, e.g.:
   ```bash
   find . -name package.json -not -path '*/node_modules/*' \
     -not -path './apps/online-docs/*' -not -path '*/dist/*' -not -path '*/release/*' \
     -print0 | xargs -0 perl -pi -e 's/"version": "OLD"/"version": "NEW"/'
   bun run scripts/verify-release-version.ts vNEW   # must pass before tagging
   ```
2. **Ship an auto-generated changelog from git history.** The `release-notes`
   job in `release-electron.yml` overwrites the GitHub Release body with
   `git log --no-merges` between the previous tag and the new tag. Keep commit
   subjects release-note quality — they ARE the changelog. (Do not hand-write
   release notes; the job regenerates them.)

**Release steps:** commit work to `main` → bump all versions (`Release X.Y.Z`
commit) → `git tag -a vX.Y.Z -m "Release X.Y.Z"` → `git push origin main` →
`git push origin vX.Y.Z`. Watch the run on the Actions tab.

### macOS builds are UNSIGNED

This fork has no Apple Developer credentials in CI, so macOS builds are shipped
**unsigned** (`apps/electron/electron-builder.yml`: `mac.identity: null`,
`notarize: false`). Users get a Gatekeeper prompt on first launch. linux/win are
unaffected. To ship **signed + notarized** macOS releases later: add the
`MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` and `APPLE_*` repo secrets (already wired
into `release-electron.yml`), then remove `identity: null` and set
`notarize: true` in `electron-builder.yml`.

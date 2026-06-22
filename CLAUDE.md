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
2. **Ship a curated changelog.** The `release-notes` job in
   `release-electron.yml` sets the GitHub Release body from, in priority order:
   1. **A hand-authored file at `.github/release-notes/<tag>.md`** (preferred).
      Write these in the upstream house style: a themed `# vX.Y.Z — <title>`
      heading, then `## Features` / `## Improvements` / `## Bug Fixes` /
      `## Breaking Changes` sections, each bullet a **bold lead-in** + prose +
      the commit hash in backticks, and `None.` for empty sections. Curate —
      fold a feature's intra-release fixes into its bullet, omit pure-internal
      churn (playground demos, lockfile bumps).
   2. **Otherwise, an auto-generated `git log --no-merges` changelog** between
      the previous tag and the new tag (fallback). For releases that fall back,
      keep commit subjects release-note quality — they ARE the changelog.

**Release steps:** commit work to `main` → write
`.github/release-notes/vX.Y.Z.md` + bump all versions (`Release X.Y.Z` commit)
→ `git tag -a vX.Y.Z -m "Release X.Y.Z"` → `git push origin main` →
`git push origin vX.Y.Z`. Watch the run on the Actions tab.

### macOS builds are UNSIGNED

This fork has no Apple Developer credentials in CI, so macOS builds are shipped
**unsigned** (`apps/electron/electron-builder.yml`: `mac.identity: null`,
`notarize: false`). Users get a Gatekeeper prompt on first launch. linux/win are
unaffected. To ship **signed + notarized** macOS releases later: add the
`MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` and `APPLE_*` repo secrets (already wired
into `release-electron.yml`), then remove `identity: null` and set
`notarize: true` in `electron-builder.yml`.

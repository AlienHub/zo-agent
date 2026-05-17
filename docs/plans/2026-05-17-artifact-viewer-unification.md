# Artifact Viewer Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify file, HTML, URL, and future document previews behind a single artifact viewer architecture, while allowing HTML artifacts to upgrade from static preview into a full in-panel browser runtime when needed.

**Architecture:** Keep the existing route-driven panel stack as the top-level shell, and introduce an artifact viewer layer that decides which runtime should back each artifact. Reuse the current `browserPane` implementation as the interactive browser runtime, but move it from a side-effect action into a first-class, route-backed viewer. Preserve static lightweight previews for safe/read-only cases, and add an explicit browser-backed mode for interactive artifacts such as JS-driven HTML, web apps, and future rich document viewers.

**Tech Stack:** Electron, React, Jotai, route-driven panel stack, browser pane IPC bridge, `@craft-agent/ui` preview overlays.

---

## Design Summary

### Why the current model breaks down

Today the product has two parallel systems:

- React-rendered preview surfaces such as `CodePreviewOverlay`, `PDFPreviewOverlay`, `HTMLPreviewOverlay`, and `SessionResourcePreviewPage`
- A separate browser runtime managed through `browserPane` in Electron main/renderer

This split works for lightweight previews, but it creates a product gap for artifacts that are still “files” from the user’s perspective and also require a real browser runtime. HTML is the first clear example:

- static HTML should preview inline
- JS-driven HTML should run in a full browser
- users still expect both experiences to live inside the same panel system

The real issue is not missing preview widgets. The issue is that the app does not yet have a unified artifact viewer contract that can route one artifact to multiple runtimes.

### Recommended direction

Use a three-layer architecture:

1. `Artifact descriptor`
   Normalizes any previewable thing into a common model.
2. `Artifact viewer router`
   Chooses the correct runtime for the artifact and current mode.
3. `Artifact runtime host`
   Renders the artifact via React preview, sandboxed iframe, browser pane, or native/open-external fallback.

This keeps the current panel shell intact and upgrades only the content side.

## Approach Options

### Option A: Keep current preview panels and only deepen “Open Live Browser”

Use the current React preview pages as-is. Improve actions so interactive artifacts can open the existing browser pane more smoothly.

**Pros**
- Lowest engineering cost
- Minimal risk to current panel architecture
- Good short-term fix for HTML

**Cons**
- Browser remains a separate system, not a true artifact viewer
- Panel history, routing, and browser state stay loosely coupled
- Future PPT/Excel/document viewers will repeat the same split-brain pattern

### Option B: Route-backed artifact viewer with browser runtime adapter

Introduce a unified artifact route and artifact viewer page. When an artifact requires full interactivity, the page mounts a browser-backed runtime instead of a React preview runtime.

**Pros**
- Best balance of reuse and maintainability
- Reuses `browserPane` without forcing a full panel system rewrite
- Gives one place to route HTML, PDFs, Office previews, images, URLs, and future artifact kinds
- Keeps artifact semantics inside the existing panel stack

**Cons**
- Requires moderate refactor across routes, panel content rendering, and browser pane ownership
- Needs lifecycle coordination between React panels and native browser instances

### Option C: Replace panel content slots with a general native-view host

Evolve `PanelSlot` itself into a container that can host either React content or native Electron views directly.

**Pros**
- Most powerful end state
- Creates a generic foundation for browser, document, canvas, and future embedded runtimes

**Cons**
- Largest surface area and highest delivery risk
- Forces early changes to panel layout, resize synchronization, focus handling, and teardown semantics
- Overkill for the first unification step

### Recommendation

Choose **Option B** first.

It turns artifact viewing into a coherent system without forcing an immediate rewrite of `PanelStackContainer` or `PanelSlot`. It also preserves a clean path toward Option C later if the product eventually wants multiple native-backed runtime types beyond browser content.

## Target Architecture

### Layer 1: Artifact descriptor

Add a shared descriptor shape that represents any viewable artifact, regardless of whether it came from a session resource link, a generated artifact, or a standalone file/URL.

Suggested shape:

```ts
type ArtifactKind =
  | 'file'
  | 'url'
  | 'html'
  | 'markdown'
  | 'code'
  | 'image'
  | 'pdf'
  | 'json'
  | 'text'
  | 'spreadsheet'
  | 'presentation'
  | 'unknown'

type ArtifactRuntime =
  | 'react-preview'
  | 'sandbox-html'
  | 'browser-pane'
  | 'native-open'

interface ArtifactDescriptor {
  id: string
  title: string
  kind: ArtifactKind
  source: {
    filePath?: string
    url?: string
    inlineContent?: string
  }
  capabilities: {
    canPreview: boolean
    canOpenExternally: boolean
    canUseBrowserRuntime: boolean
    canCopyPath: boolean
  }
  preferredRuntime: ArtifactRuntime
  fallbackRuntime: ArtifactRuntime | null
}
```

This descriptor should be derived from one place so that:

- session resource previews
- markdown `html-preview` blocks
- file preview overlays
- future generated artifacts

all follow the same classification rules.

### Layer 2: Artifact viewer router

Introduce a dedicated artifact route and page pair.

Suggested route family:

- keep current `view.sessionResource(...)` temporarily for compatibility
- add a new route family such as `view.artifact(...)`
- allow artifact mode such as `preview` or `live`

Example semantics:

- `view/artifact/<encoded id or target>?mode=preview`
- `view/artifact/<encoded id or target>?mode=live`

The router resolves the artifact descriptor, then selects the runtime:

- `react-preview` for markdown/code/text/json
- `sandbox-html` for static HTML
- `browser-pane` for JS-driven HTML, URLs, and interactive web artifacts
- `native-open` for unsupported binary formats

### Layer 3: Artifact runtime host

Create a host component responsible for rendering the chosen runtime.

Suggested component structure:

- `ArtifactViewerPage`
- `ArtifactViewerShell`
- `ArtifactRuntimeRouter`
- `ReactArtifactRuntime`
- `BrowserArtifactRuntime`
- `ExternalArtifactFallback`

This host owns:

- header actions
- loading/error states
- runtime switching between preview and live
- consistent panel title behavior
- artifact-level actions such as copy path, open externally, show in Finder, send to workspace

## Reusing the Existing Browser Runtime

### What can be reused directly

The current browser system is already strong enough to serve as the interactive artifact runtime:

- renderer entry point in [browser-pane.ts](/Users/alien/Documents/Space/craft-agents-oss/apps/electron/src/renderer/lib/browser-pane.ts:1)
- main-process orchestration in [browser-pane-manager.ts](/Users/alien/Documents/Space/craft-agents-oss/apps/electron/src/main/browser-pane-manager.ts:1)
- IPC registration in [browser.ts](/Users/alien/Documents/Space/craft-agents-oss/apps/electron/src/main/handlers/browser.ts:1)
- top-bar browser tab state and global registry

This means the refactor should not invent a second browser implementation.

### What must change

The main structural gap is ownership.

Today:

- preview page creates a browser instance as a side effect
- browser lifetime is global and tab-centric
- the preview panel does not own the browser runtime it launched

Target:

- artifact viewer route owns the runtime selection
- a live artifact panel binds to a browser instance deterministically
- panel close destroys or detaches the associated browser runtime according to policy
- panel focus can focus the browser runtime

That means we need an adapter layer between panel routes and browser pane instances.

## Phase Plan

### Phase 1: Unify artifact classification and route-level viewer shell

**Outcome**
- One artifact viewer page handles all session resource previews
- Existing preview components remain reusable underneath
- Browser runtime is still optional, but routing becomes centralized

**Files:**
- Create: `apps/electron/src/renderer/lib/artifacts.ts`
- Create: `apps/electron/src/renderer/pages/ArtifactViewerPage.tsx`
- Modify: `apps/electron/src/shared/routes.ts`
- Modify: `apps/electron/src/shared/types.ts`
- Modify: `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx`
- Modify: `apps/electron/src/renderer/pages/SessionResourcePreviewPage.tsx`
- Modify: `packages/ui/src/lib/file-classification.ts`
- Modify: `packages/ui/src/lib/html-preview.ts`

**Step 1: Define a normalized artifact descriptor**

Implement an Electron-side helper that translates file paths, URLs, and session resource inputs into a unified descriptor.

**Step 2: Add an artifact route**

Introduce a new route family without breaking existing `sessionResource` links. Existing session resource routes may resolve internally to the new artifact viewer page.

**Step 3: Build `ArtifactViewerPage`**

Create a shell that reads the descriptor and renders the appropriate React-based runtime for non-browser cases.

**Step 4: Retire direct preview logic from `SessionResourcePreviewPage`**

Reduce it to a compatibility wrapper or remove it after route migration.

**Step 5: Verify behavior**

Run typechecks and targeted preview tests for HTML, markdown, code, image, PDF, JSON, and text routes.

### Phase 2: Promote browser-pane to a route-backed artifact runtime

**Outcome**
- A live artifact panel can host a dedicated browser-backed mode
- HTML preview can switch between safe preview and live runtime without leaving the panel system

**Files:**
- Create: `apps/electron/src/renderer/components/artifacts/BrowserArtifactRuntime.tsx`
- Create: `apps/electron/src/renderer/hooks/useArtifactBrowserRuntime.ts`
- Modify: `apps/electron/src/renderer/lib/browser-pane.ts`
- Modify: `apps/electron/src/renderer/components/app-shell/PanelSlot.tsx`
- Modify: `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx`
- Modify: `apps/electron/src/renderer/pages/ArtifactViewerPage.tsx`
- Modify: `apps/electron/src/renderer/atoms/panel-stack.ts`
- Modify: `apps/electron/src/shared/types.ts`

**Step 1: Add panel-to-browser binding metadata**

Track which panel owns which browser instance so focus, close, and restore behaviors are deterministic.

**Step 2: Add live-mode artifact runtime**

Mount a browser-backed runtime when the artifact descriptor selects `browser-pane`.

**Step 3: Add runtime switching**

Allow HTML artifacts to switch from static preview to live mode in the same panel route.

**Step 4: Close/focus synchronization**

Closing the panel destroys or releases the owned browser instance. Focusing the panel focuses the browser runtime.

**Step 5: Verify resize/focus behavior**

Test multi-panel drag, focus transfer, panel close, and route replacement.

### Phase 3: Add first-class artifact actions and capability matrix

**Outcome**
- Artifact actions become consistent across previews
- The shell can support more artifact kinds without duplicating header logic

**Files:**
- Create: `apps/electron/src/renderer/components/artifacts/ArtifactHeaderActions.tsx`
- Create: `apps/electron/src/renderer/components/artifacts/artifact-capabilities.ts`
- Modify: `apps/electron/src/renderer/pages/ArtifactViewerPage.tsx`
- Modify: `packages/ui/src/components/markdown/MarkdownHtmlBlock.tsx`
- Modify: `packages/ui/src/components/overlay/HTMLPreviewOverlay.tsx`

**Step 1: Centralize actions**

Move open externally, live mode, copy path, copy source, and show in Finder into one artifact action model.

**Step 2: Align chat and file preview surfaces**

Make markdown HTML blocks and fullscreen overlays route into the same artifact action rules.

**Step 3: Add capability-driven rendering**

Ensure unsupported artifact types degrade to a file-card style fallback instead of custom per-surface messages.

### Phase 4: Extend the model to documents such as spreadsheets and presentations

**Outcome**
- Office-like artifacts use the same shell and routing
- Product can choose per-format runtime without rewriting panel behavior

**Files:**
- Create: `apps/electron/src/renderer/components/artifacts/SpreadsheetArtifactRuntime.tsx`
- Create: `apps/electron/src/renderer/components/artifacts/PresentationArtifactRuntime.tsx`
- Modify: artifact descriptor and capability logic

**Step 1: Decide preview strategy per document family**

For each format, choose among:

- rendered HTML preview
- PDF/image derivative
- browser runtime wrapper
- native external open fallback

**Step 2: Plug new runtimes into artifact router**

No panel-shell changes should be required if phases 1-3 land correctly.

## Ownership and Lifecycle Rules

These rules are important to avoid subtle bugs:

1. A browser-backed artifact panel must have a stable panel-to-browser binding.
2. A browser instance created for an artifact panel should not silently become a global unowned tab.
3. If the same artifact opens in two panels, each panel should get an explicit policy:
   either separate instances, or shared instance with focus handoff. Separate instances are safer for phase 2.
4. Closing the panel must clean up owned browser instances.
5. Panel resize must update the browser runtime viewport without forcing React rerenders on every mousemove.

## Why this is better than “just embed browser pane everywhere”

If we directly wire browser pane into every preview surface now, we create hidden coupling between:

- panel layout
- browser ownership
- artifact classification
- header actions
- document format support

The recommended architecture avoids that by first unifying the artifact contract, then swapping in browser runtime only where it makes sense.

This keeps:

- HTML interactive previews
- URL previews
- future spreadsheet/presentation viewers

on one conceptual path instead of building three unrelated embedding systems.

## Testing Strategy

### Unit tests

**Files:**
- Create: `apps/electron/src/renderer/lib/__tests__/artifacts.test.ts`
- Extend: `packages/ui/src/lib/__tests__/html-preview.test.ts`

Cover:

- descriptor classification
- static vs live HTML routing
- capability matrix behavior

### Renderer integration tests

**Files:**
- Create: `apps/electron/src/renderer/components/artifacts/__tests__/ArtifactViewerPage.test.tsx`

Cover:

- artifact route rendering
- action visibility by capability
- runtime selection

### Main/IPC tests

**Files:**
- Extend: `apps/electron/src/main/__tests__/browser-pane-manager.test.ts`
- Extend: `apps/electron/src/main/handlers/__tests__/registration-profiles.test.ts`

Cover:

- file-backed browser navigation
- panel-owned browser teardown policy
- route-to-browser binding integrity

### Manual verification

Run through:

1. open static HTML in panel preview
2. open JS-driven HTML and switch to live mode
3. drag panel sashes while live browser is visible
4. duplicate the same artifact in another panel
5. close focused and unfocused live panels
6. open PDF/image/code artifacts and confirm unchanged behavior

## Delivery Recommendation

Ship this in two product milestones:

### Milestone 1

- Phase 1
- Phase 2 for HTML and URLs only

This solves the current pain point and establishes the architecture.

### Milestone 2

- Phase 3
- selective Phase 4 for spreadsheet/presentation/document artifacts

This expands the artifact system without blocking the browser-backed HTML fix.

## Final Recommendation

Do not treat this as “make HTML preview execute JS”.

Treat it as:

- introducing a first-class artifact viewer layer
- promoting browser runtime to an artifact runtime
- keeping panel routing as the source of truth

That gives the product a durable foundation for HTML, browser tabs, PDFs, Office-style previews, and future generated artifacts.

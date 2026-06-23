import { Eye, FileText, Layers3, PencilLine } from 'lucide-react'
import { CanvasArtifactStub } from './artifacts/CanvasArtifactStub'
import { MarkdownArtifact } from './artifacts/MarkdownArtifact'
import type { ArtifactKind, ArtifactType } from './types'

const initialMarkdown = `# Product Direction Brief

The panel should become the place where a user works on the current object: a document, board, browser page, task list, or canvas. Chat remains available, but the artifact is the primary surface.

## Product decision

Use the existing panel model as the host. Each artifact keeps the same panel chrome, focus behavior, annotation entry, and restore state. The renderer changes by content type.

## First production surface

- Markdown document: readable by default, editable on demand, commentable by selection.
- Canvas: mounted as an Excalidraw artifact surface in the Agent Canvas Artifact playground item.

## Host boundary

The URL carries artifact identity and light view state. The document body, dirty state, and annotations belong in the artifact store rather than the panel route.`

export const ARTIFACT_REGISTRY: Record<ArtifactKind, ArtifactType> = {
  markdown: {
    kind: 'markdown',
    title: 'Product Direction Brief',
    icon: FileText,
    caps: {
      editable: true,
      annotatable: true,
    },
    initialContent: initialMarkdown,
    defaultViewMode: 'edit',
    viewModes: [
      { value: 'read', label: 'Read', icon: Eye },
      { value: 'edit', label: 'Edit', icon: PencilLine },
    ],
    Renderer: MarkdownArtifact,
  },
  canvas: {
    kind: 'canvas',
    title: 'Decision Canvas',
    icon: Layers3,
    caps: {
      editable: false,
      annotatable: false,
    },
    initialContent: '',
    Renderer: CanvasArtifactStub,
  },
}

export const DEFAULT_ARTIFACT_KIND: ArtifactKind = 'markdown'

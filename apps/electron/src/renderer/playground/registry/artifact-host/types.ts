import type * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import type { AnnotationV1 } from '../../../../shared/types'

export type ArtifactKind = 'markdown' | 'canvas'
export type MarkdownMode = 'read' | 'edit'

export interface ArtifactAnchor {
  kind: string
  ref: string
  preview: string
}

export interface ArtifactAnnotationSurface {
  enabled: boolean
  sessionId: string
  messageId: string
  annotations: AnnotationV1[]
  onAddAnnotation(messageId: string, annotation: AnnotationV1): void | Promise<void>
  onRemoveAnnotation(messageId: string, annotationId: string): void | Promise<void>
  onUpdateAnnotation(messageId: string, annotationId: string, patch: Partial<AnnotationV1>): void | Promise<void>
  onSaveAndSendFollowUp(target: {
    messageId: string
    annotationId: string
    note: string
    selectedText: string
  }): void
}

export interface ArtifactViewMode {
  value: string
  label: string
  icon: LucideIcon
}

export interface ArtifactRenderProps {
  content: string
  editable: boolean
  viewMode?: string
  annotationSurface?: ArtifactAnnotationSurface
  onChange(nextContent: string): void
  onSelectAnchor(anchor: ArtifactAnchor | null): void
}

export interface ArtifactType {
  kind: ArtifactKind
  title: string
  icon: LucideIcon
  caps: {
    editable: boolean
    annotatable: boolean
  }
  initialContent: string
  defaultViewMode?: string
  viewModes?: ArtifactViewMode[]
  Renderer: React.ComponentType<ArtifactRenderProps>
}

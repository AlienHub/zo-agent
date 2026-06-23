import * as React from 'react'
import {
  AnnotatableMarkdownDocument,
  CollapsibleMarkdownProvider,
  Markdown,
  TiptapMarkdownEditor,
} from '@craft-agent/ui'
import type { ArtifactAnnotationSurface, ArtifactRenderProps, MarkdownMode } from '../types'

function normalizeMode(value: string | undefined): MarkdownMode {
  return value === 'read' || value === 'edit' ? value : 'edit'
}

export function MarkdownArtifact({
  content,
  editable,
  viewMode,
  annotationSurface,
  onChange,
}: ArtifactRenderProps) {
  const mode = normalizeMode(viewMode)

  return (
    <div className="h-full min-h-0 overflow-auto rounded-[8px] border border-border/60 bg-background shadow-minimal">
      {editable && mode === 'edit' ? (
        <TiptapMarkdownEditor
          content={content}
          onUpdate={onChange}
          placeholder="Start writing..."
          markdownEngine="official"
          className="min-h-full px-6 py-5 text-sm leading-relaxed text-foreground"
        />
      ) : (
        <article className="px-6 py-5">
          <MarkdownPreview content={content} annotationSurface={annotationSurface} />
        </article>
      )}
    </div>
  )
}

function MarkdownPreview({
  content,
  annotationSurface,
}: {
  content: string
  annotationSurface?: ArtifactAnnotationSurface
}) {
  if (annotationSurface?.enabled) {
    return (
      <CollapsibleMarkdownProvider>
        <AnnotatableMarkdownDocument
          content={content}
          sessionId={annotationSurface.sessionId}
          messageId={annotationSurface.messageId}
          annotations={annotationSurface.annotations}
          onAddAnnotation={annotationSurface.onAddAnnotation}
          onRemoveAnnotation={annotationSurface.onRemoveAnnotation}
          onUpdateAnnotation={annotationSurface.onUpdateAnnotation}
          onSaveAndSendFollowUp={annotationSurface.onSaveAndSendFollowUp}
          islandZIndex={420}
          islandUsePortal
        />
      </CollapsibleMarkdownProvider>
    )
  }

  return (
    <CollapsibleMarkdownProvider>
      <Markdown mode="full" className="text-sm leading-7">
        {content}
      </Markdown>
    </CollapsibleMarkdownProvider>
  )
}

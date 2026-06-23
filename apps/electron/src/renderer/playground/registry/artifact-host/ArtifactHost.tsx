import * as React from 'react'
import { Save } from 'lucide-react'
import {
  normalizeFollowUpText,
} from '@craft-agent/ui'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import type { AnnotationV1 } from '../../../../shared/types'
import {
  ARTIFACT_SESSION_ID,
  formatResourceFollowUpMessage,
  getResourceAnnotationMessageId,
  markFollowUpSent,
} from './annotations'
import { ARTIFACT_REGISTRY, DEFAULT_ARTIFACT_KIND } from './registry'
import type { ArtifactAnnotationSurface, ArtifactKind, MarkdownMode } from './types'

interface ArtifactHostProps {
  artifactKind: ArtifactKind
  markdownMode: MarkdownMode
  showComments: boolean
}

const EMPTY_ANNOTATIONS: AnnotationV1[] = []

function createInitialContentState(): Record<string, string> {
  return Object.fromEntries(
    Object.values(ARTIFACT_REGISTRY).map(artifact => [artifact.kind, artifact.initialContent])
  )
}

function createInitialViewModeState(): Record<string, string> {
  return Object.fromEntries(
    Object.values(ARTIFACT_REGISTRY)
      .filter(artifact => artifact.viewModes?.length)
      .map(artifact => [artifact.kind, artifact.defaultViewMode ?? artifact.viewModes?.[0]?.value ?? ''])
  )
}

function resolveRegisteredKind(kind: ArtifactKind): ArtifactKind {
  return ARTIFACT_REGISTRY[kind]?.kind ?? DEFAULT_ARTIFACT_KIND
}

function resolveViewMode(artifact: (typeof ARTIFACT_REGISTRY)[ArtifactKind], preferred?: string): string | undefined {
  if (!artifact.viewModes?.length) return preferred
  return artifact.viewModes.some(mode => mode.value === preferred)
    ? preferred
    : artifact.defaultViewMode ?? artifact.viewModes[0]?.value
}

export function ArtifactHost({ artifactKind, markdownMode, showComments }: ArtifactHostProps) {
  const [activeKind, setActiveKind] = React.useState<ArtifactKind>(() => resolveRegisteredKind(artifactKind))
  const [contentByKind, setContentByKind] = React.useState(createInitialContentState)
  const [savedContentByKind, setSavedContentByKind] = React.useState(createInitialContentState)
  const [viewModeByKind, setViewModeByKind] = React.useState(createInitialViewModeState)
  const [annotationsByKind, setAnnotationsByKind] = React.useState<Record<string, AnnotationV1[]>>({})
  const [lastFollowUpAtByKind, setLastFollowUpAtByKind] = React.useState<Record<string, number>>({})

  React.useEffect(() => {
    setActiveKind(resolveRegisteredKind(artifactKind))
  }, [artifactKind])

  React.useEffect(() => {
    const nextKind = resolveRegisteredKind(artifactKind)
    const nextArtifact = ARTIFACT_REGISTRY[nextKind]
    const nextMode = resolveViewMode(nextArtifact, markdownMode)
    if (!nextMode) return

    setViewModeByKind(prev => ({
      ...prev,
      [nextArtifact.kind]: nextMode,
    }))
  }, [artifactKind, markdownMode])

  const artifact = ARTIFACT_REGISTRY[activeKind]
  const Renderer = artifact.Renderer
  const content = contentByKind[artifact.kind] ?? artifact.initialContent
  const savedContent = savedContentByKind[artifact.kind] ?? artifact.initialContent
  const annotations = annotationsByKind[artifact.kind] ?? EMPTY_ANNOTATIONS
  const messageId = getResourceAnnotationMessageId(artifact.kind)
  const lastFollowUpAt = lastFollowUpAtByKind[artifact.kind]
  const isDirty = content !== savedContent
  const currentViewMode = resolveViewMode(artifact, viewModeByKind[artifact.kind])
  const currentViewModeIndex = artifact.viewModes?.findIndex(mode => mode.value === currentViewMode) ?? -1
  const nextViewMode = artifact.viewModes?.length && currentViewModeIndex >= 0
    ? artifact.viewModes[(currentViewModeIndex + 1) % artifact.viewModes.length]
    : null
  const NextViewModeIcon = nextViewMode?.icon

  const setContent = React.useCallback((nextContent: string) => {
    setContentByKind(prev => ({ ...prev, [artifact.kind]: nextContent }))
  }, [artifact.kind])

  const updateAnnotations = React.useCallback((updater: (current: AnnotationV1[]) => AnnotationV1[]) => {
    setAnnotationsByKind(prev => ({
      ...prev,
      [artifact.kind]: updater(prev[artifact.kind] ?? []),
    }))
  }, [artifact.kind])

  const handleAddAnnotation = React.useCallback((_messageId: string, annotation: AnnotationV1) => {
    updateAnnotations(current => [...current, annotation])
  }, [updateAnnotations])

  const handleRemoveAnnotation = React.useCallback((_messageId: string, annotationId: string) => {
    updateAnnotations(current => current.filter(annotation => annotation.id !== annotationId))
  }, [updateAnnotations])

  const handleUpdateAnnotation = React.useCallback((_messageId: string, annotationId: string, patch: Partial<AnnotationV1>) => {
    updateAnnotations(current => current.map(annotation =>
      annotation.id === annotationId
        ? { ...annotation, ...patch, updatedAt: patch.updatedAt ?? Date.now() }
        : annotation
    ))
  }, [updateAnnotations])

  const handleSaveAndSendFollowUp = React.useCallback((followUp: {
    annotationId: string
    note: string
    selectedText: string
  }) => {
    const note = normalizeFollowUpText(followUp.note)
    if (!note) return

    formatResourceFollowUpMessage({
      artifactKind: artifact.kind,
      note,
      selectedText: followUp.selectedText,
    })
    setLastFollowUpAtByKind(prev => ({ ...prev, [artifact.kind]: Date.now() }))
    updateAnnotations(current => current.map(candidate =>
      candidate.id === followUp.annotationId ? markFollowUpSent(candidate, note) : candidate
    ))
  }, [artifact.kind, updateAnnotations])

  const handleSave = React.useCallback(() => {
    setSavedContentByKind(prev => ({ ...prev, [artifact.kind]: content }))
  }, [artifact.kind, content])

  const handleSwitchViewMode = React.useCallback(() => {
    if (!nextViewMode) return
    setViewModeByKind(prev => ({
      ...prev,
      [artifact.kind]: nextViewMode.value,
    }))
  }, [artifact.kind, nextViewMode])

  const annotationSurface = React.useMemo<ArtifactAnnotationSurface>(() => ({
    enabled: showComments && artifact.caps.annotatable,
    sessionId: ARTIFACT_SESSION_ID,
    messageId,
    annotations,
    onAddAnnotation: handleAddAnnotation,
    onRemoveAnnotation: handleRemoveAnnotation,
    onUpdateAnnotation: handleUpdateAnnotation,
    onSaveAndSendFollowUp: handleSaveAndSendFollowUp,
  }), [
    annotations,
    artifact.caps.annotatable,
    handleAddAnnotation,
    handleRemoveAnnotation,
    handleSaveAndSendFollowUp,
    handleUpdateAnnotation,
    messageId,
    showComments,
  ])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <PanelHeader
        title={artifact.title}
        actions={(
          <div className="flex items-center gap-1">
            {nextViewMode && NextViewModeIcon && (
              <PanelHeaderCenterButton
                icon={<NextViewModeIcon className="size-4" />}
                aria-label={`Switch to ${nextViewMode.label}`}
                onClick={handleSwitchViewMode}
              />
            )}
            {isDirty && (
              <PanelHeaderCenterButton
                icon={<Save className="size-4" />}
                aria-label="Save artifact"
                onClick={handleSave}
              />
            )}
          </div>
        )}
      />

      <div className="flex min-h-0 flex-1 border-t border-border/60 bg-foreground-3">
        <main className="flex min-w-0 flex-1 flex-col gap-3 p-3">
          {lastFollowUpAt && (
            <div className="rounded-[8px] border border-border/60 bg-background px-3 py-2 text-xs text-muted-foreground shadow-minimal">
              Follow-up sent through the shared annotation flow.
            </div>
          )}

          <section className="relative min-h-0 flex-1">
            <Renderer
              content={content}
              editable={artifact.caps.editable}
              viewMode={currentViewMode}
              annotationSurface={annotationSurface}
              onChange={setContent}
              onSelectAnchor={() => {}}
            />
          </section>
        </main>
      </div>
    </div>
  )
}

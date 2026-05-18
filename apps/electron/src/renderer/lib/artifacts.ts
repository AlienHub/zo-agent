import { classifyFile, type FileClassification, type FilePreviewType } from '@craft-agent/ui'
import { normalizeLocalFileTarget } from '@/lib/file-link-target'
import type { SessionArtifactTarget } from '../../shared/types'

export type ArtifactRuntime =
  | 'react-preview'
  | 'sandbox-html'
  | 'browser-pane'
  | 'native-open'

export type ArtifactKind =
  | 'url'
  | 'file'
  | FilePreviewType
  | 'unknown'

export interface ArtifactDescriptor {
  title: string
  source: SessionArtifactTarget
  kind: ArtifactKind
  fileClassification: FileClassification | null
  previewType: FilePreviewType | null
  canPreview: boolean
  canUseBrowserRuntime: boolean
  preferredRuntime: ArtifactRuntime
  fallbackRuntime: ArtifactRuntime | null
}

function getFileTitle(path: string): string {
  const trimmed = path.trim()
  const normalized = trimmed.replace(/\/+$/, '')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || trimmed
}

function getUrlTitle(target: string): string {
  try {
    const parsed = new URL(target)
    return parsed.hostname || parsed.href
  } catch {
    return target
  }
}

export function describeArtifact(target: SessionArtifactTarget): ArtifactDescriptor {
  if (target.kind === 'url') {
    return {
      title: getUrlTitle(target.target),
      source: target,
      kind: 'url',
      fileClassification: null,
      previewType: null,
      canPreview: true,
      canUseBrowserRuntime: true,
      preferredRuntime: 'browser-pane',
      fallbackRuntime: null,
    }
  }

  const normalizedTarget = normalizeLocalFileTarget(target.target)
  const classification = classifyFile(normalizedTarget)
  const previewType = classification.type
  const kind: ArtifactKind = previewType ?? 'file'

  return {
    title: getFileTitle(normalizedTarget),
    source: {
      kind: 'file',
      target: normalizedTarget,
    },
    kind,
    fileClassification: classification,
    previewType,
    canPreview: classification.canPreview,
    canUseBrowserRuntime: previewType === 'html',
    preferredRuntime: previewType === 'html'
      ? 'sandbox-html'
      : (classification.canPreview ? 'react-preview' : 'native-open'),
    fallbackRuntime: previewType === 'html' ? 'browser-pane' : null,
  }
}

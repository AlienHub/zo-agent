import type { ComponentEntry } from '../types'
import { ArtifactHost } from './ArtifactHost'
import { canvasSeedScenes } from './seedScenes'
import type { ArtifactKind, MarkdownMode } from './types'

interface ArtifactHostPlaygroundProps {
  artifactKind: ArtifactKind
  markdownMode: MarkdownMode
  showComments: boolean
  initialContent?: string
}

function ArtifactHostPlayground({
  artifactKind,
  markdownMode,
  showComments,
  initialContent,
}: ArtifactHostPlaygroundProps) {
  return (
    <ArtifactHost
      key={`${artifactKind}:${initialContent ?? ''}`}
      artifactKind={artifactKind}
      markdownMode={markdownMode}
      showComments={showComments}
      initialContent={initialContent}
    />
  )
}

export const artifactHostComponents: ComponentEntry[] = [
  {
    id: 'artifact-host-product-shape',
    name: 'Panel Artifact Surface',
    category: 'Artifact Host',
    description: 'Registry-mounted artifact host with Markdown renderer, shared Island annotations, and Canvas as a registered surface.',
    component: ArtifactHostPlayground,
    layout: 'full',
    previewOverflow: 'hidden',
    props: [
      {
        name: 'artifactKind',
        description: 'Artifact renderer mounted by the registry.',
        control: {
          type: 'select',
          options: [
            { label: 'Markdown', value: 'markdown' },
            { label: 'Canvas', value: 'canvas' },
          ],
        },
        defaultValue: 'markdown',
      },
      {
        name: 'markdownMode',
        description: 'Markdown renderer mode.',
        control: {
          type: 'select',
          options: [
            { label: 'Read', value: 'read' },
            { label: 'Edit', value: 'edit' },
          ],
        },
        defaultValue: 'edit',
      },
      {
        name: 'showComments',
        description: 'Enable the shared Island annotation flow inside annotatable artifacts.',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'initialContent',
        description: 'Canvas scene JSON seed used by playground variants.',
        control: { type: 'textarea', rows: 6 },
        defaultValue: canvasSeedScenes['product-map'],
      },
    ],
    variants: [
      {
        name: 'Markdown editor',
        description: 'Editable Markdown artifact mounted in the generic host.',
        props: {
          artifactKind: 'markdown',
          markdownMode: 'edit',
          showComments: true,
        },
      },
      {
        name: 'Markdown reader',
        description: 'Read-only Markdown presentation with host annotations.',
        props: {
          artifactKind: 'markdown',
          markdownMode: 'read',
          showComments: true,
        },
      },
      {
        name: 'Canvas product map',
        description: 'Editable Excalidraw canvas mounted through the artifact registry.',
        props: {
          artifactKind: 'canvas',
          markdownMode: 'edit',
          showComments: true,
          initialContent: canvasSeedScenes['product-map'],
        },
      },
      {
        name: 'Canvas workflow',
        description: 'Workflow seed mounted as the same registered canvas artifact.',
        props: {
          artifactKind: 'canvas',
          markdownMode: 'edit',
          showComments: true,
          initialContent: canvasSeedScenes.workflow,
        },
      },
      {
        name: 'Canvas review',
        description: 'Review seed mounted as the same registered canvas artifact.',
        props: {
          artifactKind: 'canvas',
          markdownMode: 'edit',
          showComments: true,
          initialContent: canvasSeedScenes.review,
        },
      },
      {
        name: 'Lean',
        description: 'Markdown editing surface without annotation affordances.',
        props: {
          artifactKind: 'markdown',
          markdownMode: 'edit',
          showComments: false,
        },
      },
    ],
  },
]

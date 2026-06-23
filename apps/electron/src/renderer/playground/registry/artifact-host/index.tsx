import type { ComponentEntry } from '../types'
import { AgentCanvasSurface } from './AgentCanvasSurface'
import { ArtifactHost } from './ArtifactHost'

export const artifactHostComponents: ComponentEntry[] = [
  {
    id: 'artifact-host-product-shape',
    name: 'Panel Artifact Surface',
    category: 'Artifact Host',
    description: 'Registry-mounted artifact host with Markdown renderer, shared Island annotations, and Canvas as a registered surface.',
    component: ArtifactHost,
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
        name: 'Canvas registry',
        description: 'Canvas kind registered in the generic host; Excalidraw panel lives in Agent Canvas Artifact.',
        props: {
          artifactKind: 'canvas',
          markdownMode: 'edit',
          showComments: true,
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
  {
    id: 'agent-canvas-surface',
    name: 'Agent Canvas Artifact',
    category: 'Artifact Host',
    description: 'Excalidraw canvas artifact where the agent builds editable board content directly on the canvas.',
    component: AgentCanvasSurface,
    layout: 'full',
    previewOverflow: 'hidden',
    props: [
      {
        name: 'agentScenario',
        description: 'Agent-authored canvas structure mounted in the panel.',
        control: {
          type: 'select',
          options: [
            { label: 'Product map', value: 'product-map' },
            { label: 'Workflow', value: 'workflow' },
            { label: 'Review', value: 'review' },
          ],
        },
        defaultValue: 'product-map',
      },
    ],
    variants: [
      {
        name: 'Product map',
        description: 'Agent builds a product decision map as editable Excalidraw elements.',
        props: { agentScenario: 'product-map' },
      },
      {
        name: 'Workflow',
        description: 'Agent builds a collaboration workflow directly on the canvas.',
        props: { agentScenario: 'workflow' },
      },
      {
        name: 'Review',
        description: 'Agent adds review notes near the current canvas selection.',
        props: { agentScenario: 'review' },
      },
    ],
  },
]

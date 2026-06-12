import * as React from 'react'
import { Provider as JotaiProvider, createStore, useSetAtom } from 'jotai'
import type { ComponentEntry } from './types'
import { AttachmentPreview } from '@/components/app-shell/AttachmentPreview'
import { SetupAuthBanner } from '@/components/app-shell/SetupAuthBanner'
import { TurnCard, type ActivityItem } from '@craft-agent/ui'
import { ChatDisplay } from '@/components/app-shell/ChatDisplay'
import SessionResourcePreviewPage from '@/pages/SessionResourcePreviewPage'
import type { BackgroundTask } from '@/components/app-shell/ActiveTasksBar'
import { ActiveOptionBadges } from '@/components/app-shell/ActiveOptionBadges'
import { ChatInputZone, InputContainer } from '@/components/app-shell/input'
import { setRecentWorkingDirs } from '@/components/app-shell/input/working-directory-history'
import type { StructuredResponse } from '@/components/app-shell/input/structured/types'
import { EmptyStateHint, getHintCount, getHintTemplate } from '@/components/chat/EmptyStateHint'
import { Button } from '@/components/ui/button'
import { motion } from 'motion/react'
import { ArrowUp, Paperclip, ChevronDown, Circle, Sparkles } from 'lucide-react'
import type { LabelConfig } from '@craft-agent/shared/labels'
import type { SessionStatus } from '@/config/session-status-config'
import type { Message } from '@craft-agent/core/types'
import type { SessionMeta } from '@/atoms/sessions'
import { loadedSessionsAtom, sessionAtomFamily, sessionMetaMapAtom } from '@/atoms/sessions'
import { ActionRegistryProvider } from '@/actions/registry'
import { DismissibleLayerProvider } from '@/context/DismissibleLayerContext'
import { EscapeInterruptProvider } from '@/context/EscapeInterruptContext'
import { FocusProvider } from '@/context/FocusContext'
import { NavigationContext } from '@/contexts/NavigationContext'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import type { FileAttachment, NavigationState, PermissionRequest, PermissionMode, Session, SessionResourceDetails } from '../../../shared/types'
import { cn } from '@/lib/utils'
import { AppShellProvider } from '@/context/AppShellContext'
import { ModalProvider } from '@/context/ModalContext'
import {
  ensureMockElectronAPI,
  mockInputCallbacks,
  mockAttachmentCallbacks,
  mockSources,
  sampleImageAttachment,
  samplePdfAttachment,
} from '../mock-utils'
import { mockAdminApprovalRequest } from '../adapters/input-adapters'
import { getRecentDirsForScenario, type RecentDirScenario } from '../recent-working-dirs'

const sampleCodeAttachment: FileAttachment = {
  type: 'text',
  path: '/Users/test/app.tsx',
  name: 'App.tsx',
  mimeType: 'text/typescript',
  size: 8500,
}

const samplePermissionRequest: PermissionRequest = {
  requestId: 'perm-1',
  sessionId: 'session-1',
  toolName: 'bash',
  description: 'Run shell command',
  command: 'npm install --save-dev typescript @types/react',
}

const longPermissionRequest: PermissionRequest = {
  requestId: 'perm-2',
  sessionId: 'session-1',
  toolName: 'bash',
  description: 'Run shell command',
  command: 'find /Users/test/project -type f -name "*.ts" | xargs grep -l "deprecated" | head -20',
}

const veryLongPermissionRequest: PermissionRequest = {
  requestId: 'perm-3',
  sessionId: 'session-1',
  toolName: 'bash',
  description: 'Run complex deployment script',
  command: `#!/bin/bash
set -e

echo "Starting deployment..."
cd /Users/project/app

# Build the application
npm run build
npm run test

# Docker operations
docker build -t myapp:latest .
docker tag myapp:latest registry.example.com/myapp:latest
docker push registry.example.com/myapp:latest

# Deploy to kubernetes
kubectl apply -f k8s/deployment.yaml
kubectl rollout status deployment/myapp`,
}

// Sample background tasks
const sampleBackgroundTasks: BackgroundTask[] = [
  {
    id: 'task-abc123',
    type: 'agent',
    toolUseId: 'tool-1',
    startTime: Date.now() - 45000, // 45 seconds ago
    elapsedSeconds: 45,
    intent: 'Explore codebase structure',
  },
  {
    id: 'shell-xyz456',
    type: 'shell',
    toolUseId: 'tool-2',
    startTime: Date.now() - 154000, // 2m 34s ago
    elapsedSeconds: 154,
  },
]

const singleBackgroundTask: BackgroundTask[] = [
  {
    id: 'task-123456',
    type: 'agent',
    toolUseId: 'tool-single',
    startTime: Date.now() - 23000,
    elapsedSeconds: 23,
    intent: 'Search for TypeScript files',
  },
]

const longRunningTasks: BackgroundTask[] = [
  {
    id: 'task-long-1',
    type: 'agent',
    toolUseId: 'tool-long-1',
    startTime: Date.now() - 3723000, // 1h 2m 3s
    elapsedSeconds: 3723,
    intent: 'Refactor authentication system',
  },
  {
    id: 'shell-long-2',
    type: 'shell',
    toolUseId: 'tool-long-2',
    startTime: Date.now() - 245000, // 4m 5s
    elapsedSeconds: 245,
  },
  {
    id: 'task-long-3',
    type: 'agent',
    toolUseId: 'tool-long-3',
    startTime: Date.now() - 12000, // 12s
    elapsedSeconds: 12,
    intent: 'Run tests',
  },
]

const inputContainerSampleLabels: LabelConfig[] = [
  { id: 'bug', name: 'Bug', color: { light: '#EF4444', dark: '#F87171' } },
  { id: 'priority', name: 'Priority', color: { light: '#F59E0B', dark: '#FBBF24' }, valueType: 'number' },
  { id: 'due-date', name: 'Due Date', color: { light: '#3B82F6', dark: '#60A5FA' }, valueType: 'date' },
  { id: 'sprint', name: 'Sprint', color: { light: '#8B5CF6', dark: '#A78BFA' }, valueType: 'string' },
]

const inputContainerSampleStatuses: SessionStatus[] = [
  {
    id: 'todo',
    label: 'Todo',
    resolvedColor: 'var(--muted-foreground)',
    icon: <Circle className="h-3.5 w-3.5" strokeWidth={1.5} />,
    iconColorable: true,
    category: 'open',
  },
  {
    id: 'in-progress',
    label: 'In Progress',
    resolvedColor: 'var(--info)',
    icon: <Circle className="h-3.5 w-3.5" strokeWidth={1.5} />,
    iconColorable: true,
    category: 'open',
  },
  {
    id: 'done',
    label: 'Done',
    resolvedColor: 'var(--success)',
    icon: <Circle className="h-3.5 w-3.5" strokeWidth={1.5} />,
    iconColorable: true,
    category: 'closed',
  },
]

const playgroundAppShellContext = {
  workspaces: [{ id: 'playground-workspace', name: 'Playground', path: '/playground', rootPath: '/playground' }],
  activeWorkspaceId: 'playground-workspace',
  activeWorkspaceSlug: 'playground-workspace',
  llmConnections: [],
  workspaceDefaultLlmConnection: undefined,
  refreshLlmConnections: async () => {},
  pendingPermissions: new Map(),
  pendingCredentials: new Map(),
  getDraft: () => '',
  sessionOptions: new Map(),
  onCreateSession: async () => ({
    id: 'playground-session',
    workspaceId: 'playground-workspace',
    workspaceName: 'Playground',
    messages: [],
    isProcessing: false,
    lastMessageAt: Date.now(),
  }),
  onSendMessage: () => {},
  onRenameSession: () => {},
  onFlagSession: () => {},
  onUnflagSession: () => {},
  onArchiveSession: () => {},
  onUnarchiveSession: () => {},
  onMarkSessionRead: () => {},
  onMarkSessionUnread: () => {},
  onSetActiveViewingSession: () => {},
  onSessionStatusChange: () => {},
  onDeleteSession: async () => true,
  onOpenFile: () => {},
  onOpenUrl: () => {},
  onSelectWorkspace: () => {},
  onRefreshWorkspaces: () => {},
  onOpenSettings: () => {},
  onOpenKeyboardShortcuts: () => {},
  onOpenStoredUserPreferences: () => {},
  onReset: () => {},
  onSessionOptionsChange: () => {},
  onInputChange: () => {},
}

// ============================================================================
// Sample Nested Tool Activities (Task subagent with child tools)
// ============================================================================

/** Flat list of tools (no nesting) */
const flatActivities: ActivityItem[] = [
  {
    id: 'tool-1',
    type: 'tool',
    status: 'completed',
    toolName: 'Read',
    toolUseId: 'read-1',
    toolInput: { file_path: 'src/components/App.tsx' },
    content: 'File contents...',
    timestamp: Date.now() - 3000,
    depth: 0,
  },
  {
    id: 'tool-2',
    type: 'tool',
    status: 'completed',
    toolName: 'Grep',
    toolUseId: 'grep-1',
    toolInput: { pattern: 'useState', path: 'src/' },
    content: '15 matches found',
    timestamp: Date.now() - 2000,
    depth: 0,
  },
  {
    id: 'tool-3',
    type: 'tool',
    status: 'completed',
    toolName: 'Edit',
    toolUseId: 'edit-1',
    toolInput: { file_path: 'src/components/App.tsx' },
    content: 'File updated',
    timestamp: Date.now() - 1000,
    depth: 0,
  },
]

/** Task with nested child tools (completed) */
const nestedActivitiesCompleted: ActivityItem[] = [
  {
    id: 'task-1',
    type: 'tool',
    status: 'completed',
    toolName: 'Task',
    toolUseId: 'task-parent-1',
    toolInput: { description: 'Explore codebase structure', subagent_type: 'Explore' },
    content: 'Exploration complete',
    timestamp: Date.now() - 5000,
    depth: 0,
  },
  {
    id: 'read-1',
    type: 'tool',
    status: 'completed',
    toolName: 'Read',
    toolUseId: 'read-child-1',
    toolInput: { file_path: 'package.json' },
    content: '{ "name": "my-app", ... }',
    timestamp: Date.now() - 4500,
    parentId: 'task-parent-1',
    depth: 1,
  },
  {
    id: 'glob-1',
    type: 'tool',
    status: 'completed',
    toolName: 'Glob',
    toolUseId: 'glob-child-1',
    toolInput: { pattern: 'src/**/*.tsx' },
    content: '24 files matched',
    timestamp: Date.now() - 4000,
    parentId: 'task-parent-1',
    depth: 1,
  },
  {
    id: 'grep-1',
    type: 'tool',
    status: 'completed',
    toolName: 'Grep',
    toolUseId: 'grep-child-1',
    toolInput: { pattern: 'export function' },
    content: '156 matches',
    timestamp: Date.now() - 3500,
    parentId: 'task-parent-1',
    depth: 1,
  },
  {
    id: 'read-2',
    type: 'tool',
    status: 'completed',
    toolName: 'Read',
    toolUseId: 'read-child-2',
    toolInput: { file_path: 'src/index.tsx' },
    content: 'Entry point file...',
    timestamp: Date.now() - 3000,
    parentId: 'task-parent-1',
    depth: 1,
  },
]

/** Task with nested child tools (in progress) */
const nestedActivitiesInProgress: ActivityItem[] = [
  {
    id: 'task-2',
    type: 'tool',
    status: 'running',
    toolName: 'Task',
    toolUseId: 'task-parent-2',
    toolInput: { description: 'Implement new feature', subagent_type: 'general-purpose' },
    timestamp: Date.now() - 3000,
    depth: 0,
  },
  {
    id: 'read-3',
    type: 'tool',
    status: 'completed',
    toolName: 'Read',
    toolUseId: 'read-child-3',
    toolInput: { file_path: 'src/components/Button.tsx' },
    content: 'Component file...',
    timestamp: Date.now() - 2500,
    parentId: 'task-parent-2',
    depth: 1,
  },
  {
    id: 'edit-2',
    type: 'tool',
    status: 'completed',
    toolName: 'Edit',
    toolUseId: 'edit-child-1',
    toolInput: { file_path: 'src/components/Button.tsx' },
    content: 'Added onClick handler',
    timestamp: Date.now() - 2000,
    parentId: 'task-parent-2',
    depth: 1,
  },
  {
    id: 'write-1',
    type: 'tool',
    status: 'running',
    toolName: 'Write',
    toolUseId: 'write-child-1',
    toolInput: { file_path: 'src/components/NewFeature.tsx' },
    timestamp: Date.now() - 500,
    parentId: 'task-parent-2',
    depth: 1,
  },
]

/** Multiple nested Task tools */
const multipleNestedTasks: ActivityItem[] = [
  {
    id: 'task-a',
    type: 'tool',
    status: 'completed',
    toolName: 'Task',
    toolUseId: 'task-a-id',
    toolInput: { description: 'Analyze code quality', subagent_type: 'Explore' },
    content: 'Analysis complete',
    timestamp: Date.now() - 10000,
    depth: 0,
  },
  {
    id: 'grep-a1',
    type: 'tool',
    status: 'completed',
    toolName: 'Grep',
    toolUseId: 'grep-a1-id',
    toolInput: { pattern: 'TODO|FIXME' },
    content: '23 issues found',
    timestamp: Date.now() - 9500,
    parentId: 'task-a-id',
    depth: 1,
  },
  {
    id: 'read-a1',
    type: 'tool',
    status: 'completed',
    toolName: 'Read',
    toolUseId: 'read-a1-id',
    toolInput: { file_path: 'src/legacy/OldComponent.tsx' },
    content: 'Legacy code...',
    timestamp: Date.now() - 9000,
    parentId: 'task-a-id',
    depth: 1,
  },
  {
    id: 'task-b',
    type: 'tool',
    status: 'completed',
    toolName: 'Task',
    toolUseId: 'task-b-id',
    toolInput: { description: 'Fix identified issues', subagent_type: 'general-purpose' },
    content: 'Issues fixed',
    timestamp: Date.now() - 5000,
    depth: 0,
  },
  {
    id: 'edit-b1',
    type: 'tool',
    status: 'completed',
    toolName: 'Edit',
    toolUseId: 'edit-b1-id',
    toolInput: { file_path: 'src/legacy/OldComponent.tsx' },
    content: 'Removed deprecated code',
    timestamp: Date.now() - 4500,
    parentId: 'task-b-id',
    depth: 1,
  },
  {
    id: 'bash-b1',
    type: 'tool',
    status: 'completed',
    toolName: 'Bash',
    toolUseId: 'bash-b1-id',
    toolInput: { command: 'npm run lint:fix', description: 'Auto-fix linting issues' },
    content: 'Fixed 12 issues',
    timestamp: Date.now() - 4000,
    parentId: 'task-b-id',
    depth: 1,
  },
  {
    id: 'write-b1',
    type: 'tool',
    status: 'completed',
    toolName: 'Write',
    toolUseId: 'write-b1-id',
    toolInput: { file_path: 'src/components/ModernComponent.tsx' },
    content: 'Created new component',
    timestamp: Date.now() - 3500,
    parentId: 'task-b-id',
    depth: 1,
  },
]

/** Deep nesting example (2+ levels) */
const deepNestedActivities: ActivityItem[] = [
  {
    id: 'task-outer',
    type: 'tool',
    status: 'completed',
    toolName: 'Task',
    toolUseId: 'task-outer-id',
    toolInput: { description: 'Refactor authentication', subagent_type: 'Plan' },
    content: 'Refactoring complete',
    timestamp: Date.now() - 8000,
    depth: 0,
  },
  {
    id: 'task-inner',
    type: 'tool',
    status: 'completed',
    toolName: 'Task',
    toolUseId: 'task-inner-id',
    toolInput: { description: 'Implement OAuth flow', subagent_type: 'general-purpose' },
    content: 'OAuth implemented',
    timestamp: Date.now() - 7500,
    parentId: 'task-outer-id',
    depth: 1,
  },
  {
    id: 'read-deep',
    type: 'tool',
    status: 'completed',
    toolName: 'Read',
    toolUseId: 'read-deep-id',
    toolInput: { file_path: 'src/auth/oauth.ts' },
    content: 'OAuth config...',
    timestamp: Date.now() - 7000,
    parentId: 'task-inner-id',
    depth: 2,
  },
  {
    id: 'edit-deep',
    type: 'tool',
    status: 'completed',
    toolName: 'Edit',
    toolUseId: 'edit-deep-id',
    toolInput: { file_path: 'src/auth/oauth.ts' },
    content: 'Added PKCE support',
    timestamp: Date.now() - 6500,
    parentId: 'task-inner-id',
    depth: 2,
  },
  {
    id: 'write-auth',
    type: 'tool',
    status: 'completed',
    toolName: 'Write',
    toolUseId: 'write-auth-id',
    toolInput: { file_path: 'src/auth/callback.ts' },
    content: 'Created callback handler',
    timestamp: Date.now() - 6000,
    parentId: 'task-inner-id',
    depth: 2,
  },
  {
    id: 'bash-test',
    type: 'tool',
    status: 'completed',
    toolName: 'Bash',
    toolUseId: 'bash-test-id',
    toolInput: { command: 'npm test', description: 'Run auth tests' },
    content: 'All tests passed',
    timestamp: Date.now() - 5000,
    parentId: 'task-outer-id',
    depth: 1,
  },
]

type InputContainerMode = 'freeform' | 'permission' | 'admin_approval'

interface InputContainerPlaygroundProps {
  disabled?: boolean
  isProcessing?: boolean
  placeholder?: string
  currentModel?: string
  permissionMode?: PermissionMode
  workingDirectory?: string
  inputMode?: InputContainerMode
  compactMode?: boolean
  showOptionBadges?: boolean
  showTasks?: boolean
  showLabels?: boolean
  showStatuses?: boolean
  labelCount?: number
  showSources?: boolean
  sourceCount?: number
  showWorkingDirectory?: boolean
  seedRecentDirs?: boolean
  recentDirScenario?: RecentDirScenario
  showAttachments?: boolean
  attachmentCount?: number
  showFollowUps?: boolean
  followUpCount?: number
}

function InputContainerPlayground({
  disabled = false,
  isProcessing = false,
  placeholder = 'Message Craft Agent...',
  currentModel = 'claude-sonnet-4-6',
  permissionMode = 'ask',
  workingDirectory = '/Users/demo/projects/craft-agent',
  inputMode = 'freeform',
  compactMode = false,
  showOptionBadges = true,
  showTasks = true,
  showLabels = true,
  showStatuses = true,
  labelCount = 3,
  showSources = true,
  sourceCount = 2,
  showWorkingDirectory = true,
  seedRecentDirs = true,
  recentDirScenario = 'few',
  showAttachments = false,
  attachmentCount = 2,
  showFollowUps = false,
  followUpCount = 2,
}: InputContainerPlaygroundProps) {
  const playgroundSessionId = 'playground-session'
  const [model, setModel] = React.useState(currentModel)
  const [mode, setMode] = React.useState<PermissionMode>(permissionMode)
  const [inputValue, setInputValue] = React.useState('')
  const [currentSessionStatus, setCurrentSessionStatus] = React.useState('in-progress')
  const [cwd, setCwd] = React.useState(workingDirectory)

  React.useEffect(() => {
    ensureMockElectronAPI()
  }, [])

  React.useEffect(() => {
    if (!seedRecentDirs) return
    setRecentWorkingDirs(getRecentDirsForScenario(recentDirScenario))
  }, [seedRecentDirs, recentDirScenario])

  React.useEffect(() => {
    setModel(currentModel)
  }, [currentModel])

  React.useEffect(() => {
    setMode(permissionMode)
  }, [permissionMode])

  React.useEffect(() => {
    setCwd(workingDirectory)
  }, [workingDirectory])

  const labels = React.useMemo(() => inputContainerSampleLabels.slice(0, Math.max(1, Math.min(labelCount, inputContainerSampleLabels.length))), [labelCount])

  const [sessionLabels, setSessionLabels] = React.useState<string[]>(['bug', 'priority::2', 'sprint::Q1-S3'])

  React.useEffect(() => {
    const next = labels.map((label) => {
      if (label.id === 'priority') return 'priority::2'
      if (label.id === 'due-date') return 'due-date::2026-03-15'
      if (label.id === 'sprint') return 'sprint::Q1-S3'
      return label.id
    })
    setSessionLabels(next)
  }, [labels])

  const sources = React.useMemo(() => mockSources.slice(0, Math.max(1, Math.min(sourceCount, mockSources.length))), [sourceCount])
  const defaultEnabled = React.useMemo(() => sources.slice(0, Math.min(2, sources.length)).map(source => source.config.slug), [sources])
  const [enabledSourceSlugs, setEnabledSourceSlugs] = React.useState<string[]>(defaultEnabled)

  React.useEffect(() => {
    setEnabledSourceSlugs(defaultEnabled)
  }, [defaultEnabled])

  const followUpItems = React.useMemo(() => {
    const samples = [
      {
        id: 'fu-a',
        messageId: 'assistant-msg-1',
        annotationId: 'annotation-1',
        index: 1,
        noteLabel: 'Prevent stale token from discarding draft input.',
        selectedText: 'Include OAuth refresh edge cases',
        color: 'info',
      },
      {
        id: 'fu-b',
        messageId: 'assistant-msg-1',
        annotationId: 'annotation-2',
        index: 2,
        noteLabel: 'Check compact mode and quick mode switching.',
        selectedText: 'Validate animation with permission mode transitions',
        color: 'info',
      },
      {
        id: 'fu-c',
        messageId: 'assistant-msg-2',
        annotationId: 'annotation-3',
        index: 3,
        noteLabel: 'Review spacing and overflow for label/source badge density.',
        selectedText: 'Review label + source badge density on narrow widths',
        color: 'info',
      },
      {
        id: 'fu-d',
        messageId: 'assistant-msg-3',
        annotationId: 'annotation-4',
        index: 4,
        noteLabel: 'Add chip click affordance for jumping back to annotation',
        selectedText: 'Add chip click affordance for jumping back to annotation',
        color: 'info',
      },
    ]
    if (!showFollowUps) return []
    return samples.slice(0, Math.max(1, Math.min(followUpCount, samples.length)))
  }, [showFollowUps, followUpCount])

  const attachmentFiles = React.useMemo(() => {
    if (!showAttachments) return [] as File[]

    const imageBytes = sampleImageAttachment.base64
      ? Uint8Array.from(atob(sampleImageAttachment.base64), char => char.charCodeAt(0))
      : new Uint8Array([137, 80, 78, 71])

    const samples: File[] = [
      new File([imageBytes], sampleImageAttachment.name, { type: sampleImageAttachment.mimeType }),
      new File(['%PDF-1.4\n% Playground sample\n'], samplePdfAttachment.name, { type: samplePdfAttachment.mimeType }),
      new File(['export function App() {\n  return <div>Hello Playground</div>\n}\n'], sampleCodeAttachment.name, { type: sampleCodeAttachment.mimeType }),
    ]

    return samples.slice(0, Math.max(1, Math.min(attachmentCount, samples.length)))
  }, [showAttachments, attachmentCount])

  const attachmentSeedKey = React.useMemo(() => {
    if (!showAttachments) return 'none'
    return attachmentFiles.map(file => `${file.name}:${file.size}`).join('|')
  }, [showAttachments, attachmentFiles])

  React.useEffect(() => {
    if (!showAttachments || attachmentFiles.length === 0) return

    const timer = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('craft:paste-files', {
        detail: {
          files: attachmentFiles,
          sessionId: playgroundSessionId,
        },
      }))
    }, 0)

    return () => clearTimeout(timer)
  }, [showAttachments, attachmentSeedKey, attachmentFiles, playgroundSessionId])

  const structuredInput = React.useMemo(() => {
    if (inputMode === 'permission') {
      return {
        type: 'permission' as const,
        data: samplePermissionRequest,
      }
    }

    if (inputMode === 'admin_approval') {
      return {
        type: 'admin_approval' as const,
        data: mockAdminApprovalRequest({
          appName: 'Docker Desktop',
          reason: 'Homebrew needs admin access to complete post-install steps.',
          impact: 'May install files in /Applications and system-managed directories.',
          command: 'brew install --cask docker',
        }),
      }
    }

    return undefined
  }, [inputMode])

  return (
    <ModalProvider>
    <AppShellProvider value={playgroundAppShellContext as any}>
      <div className="w-full h-full flex flex-col bg-background">
        <div className="flex-1" />

        <ChatInputZone
          key={`input:${inputMode}:${compactMode ? 'compact' : 'full'}:${showAttachments ? attachmentSeedKey : 'none'}:${showFollowUps ? followUpCount : 0}:${seedRecentDirs ? recentDirScenario : 'unseeded'}`}
          compactMode={compactMode}
          showOptionBadges={showOptionBadges}
          permissionMode={mode}
          onPermissionModeChange={setMode}
          tasks={showTasks ? sampleBackgroundTasks : []}
          sessionId={playgroundSessionId}
          onKillTask={(taskId) => console.log('[Playground] Kill task:', taskId)}
          onInsertMessage={setInputValue}
          sessionLabels={showLabels ? sessionLabels : []}
          labels={showLabels ? labels : []}
          onLabelsChange={setSessionLabels}
          sessionStatuses={showStatuses ? inputContainerSampleStatuses : []}
          currentSessionStatus={showStatuses ? currentSessionStatus : undefined}
          onSessionStatusChange={setCurrentSessionStatus}
          inputProps={{
            placeholder,
            disabled,
            isProcessing,
            structuredInput,
            onStructuredResponse: (response) => {
              console.log('[Playground] Structured response:', response)
            },
            currentModel: model,
            sources: showSources ? sources : [],
            enabledSourceSlugs: showSources ? enabledSourceSlugs : [],
            onSourcesChange: showSources ? setEnabledSourceSlugs : undefined,
            workingDirectory: showWorkingDirectory ? cwd : undefined,
            onWorkingDirectoryChange: showWorkingDirectory ? setCwd : undefined,
            followUpItems,
            onSubmit: mockInputCallbacks.onSubmit,
            onModelChange: setModel,
            onInputChange: setInputValue,
            inputValue,
            onHeightChange: mockInputCallbacks.onHeightChange,
            onFocusChange: mockInputCallbacks.onFocusChange,
            onStop: mockInputCallbacks.onStop,
          }}
        />
      </div>
    </AppShellProvider>
    </ModalProvider>
  )
}

/**
 * Contextual wrapper for ActiveTasksBar showing it with messages and input
 */
interface ActiveTasksBarContextProps {
  tasks?: BackgroundTask[]
}

function ActiveTasksBarContext({ tasks = sampleBackgroundTasks }: ActiveTasksBarContextProps) {
  const [permissionMode, setPermissionMode] = React.useState<PermissionMode>('ask')

  // Inject mock electronAPI for file attachments
  React.useEffect(() => {
    ensureMockElectronAPI()
  }, [])

  return (
    <div className="w-full max-w-[960px] h-full flex flex-col">
      {/* Sample messages for context - matches ChatDisplay padding */}
      <div className="flex-1 overflow-auto px-5 py-8 space-y-2.5">
        {/* User message */}
        <div className="pt-3 flex justify-end">
          <div className="max-w-[80%] rounded-2xl bg-foreground text-background px-4 py-2">
            <p className="text-sm">Can you explore the codebase structure and analyze the API endpoints?</p>
          </div>
        </div>

        {/* Assistant message */}
        <div className="flex justify-start">
          <div className="max-w-[80%] rounded-2xl bg-muted px-4 py-2">
            <p className="text-sm">I'll explore the codebase and analyze the API endpoints. Let me start by running a background task to search for API route definitions...</p>
          </div>
        </div>
      </div>

      {/* Input area - matches ChatDisplay padding */}
      <div className="mx-auto w-full px-4 pb-4 mt-1" style={{ maxWidth: 'var(--content-max-width, 960px)' }}>
        {/* Active option badges and tasks */}
        <ActiveOptionBadges
          permissionMode={permissionMode}
          onPermissionModeChange={setPermissionMode}
          tasks={tasks}
          sessionId="playground-session"
          onKillTask={(taskId) => console.log('[Playground] Kill task:', taskId)}
        />

        {/* Real InputContainer */}
        <InputContainer
          placeholder="Message Craft Agent..."
          disabled={false}
          isProcessing={false}
          currentModel="claude-sonnet-4-6"
          permissionMode={permissionMode}
          onPermissionModeChange={setPermissionMode}
          sources={mockSources}
          enabledSourceSlugs={['github-api', 'local-files']}
          workingDirectory="/Users/demo/projects/craft-agent"
          sessionId="playground-session"
          onSubmit={mockInputCallbacks.onSubmit}
          onModelChange={mockInputCallbacks.onModelChange}
          onInputChange={mockInputCallbacks.onInputChange}
          onHeightChange={mockInputCallbacks.onHeightChange}
          onFocusChange={mockInputCallbacks.onFocusChange}
          onSourcesChange={mockInputCallbacks.onSourcesChange}
          onWorkingDirectoryChange={mockInputCallbacks.onWorkingDirectoryChange}
          onStop={mockInputCallbacks.onStop}
        />
      </div>
    </div>
  )
}

const desktopChatMessages: Message[] = [
  {
    id: 'desktop-user-1',
    role: 'user',
    content: '帮我把这个 onboarding funnel 做成一个可以发给团队 review 的 HTML 报告，同时保留 markdown 版 brief。',
    timestamp: Date.now() - 6 * 60_000,
  },
  {
    id: 'desktop-assistant-1',
    role: 'assistant',
    content:
      '可以。我会先把核心指标整理成一个简洁的 narrative，然后生成两个可预览产物：\n\n' +
      '- `onboarding-funnel.html` 用于视觉 review\n' +
      '- `onboarding-brief.md` 用于异步批注\n\n' +
      '右侧预览面板现在显示 HTML 版本，你也可以切到 Markdown brief 查看结构。',
    timestamp: Date.now() - 5 * 60_000,
    turnId: 'desktop-turn-1',
  },
  {
    id: 'desktop-user-2',
    role: 'user',
    content: '重点看激活率掉在哪一步，别做成 landing page。',
    timestamp: Date.now() - 3 * 60_000,
  },
  {
    id: 'desktop-assistant-2',
    role: 'assistant',
    content:
      '收到。我把版式处理成工作台风格：左边保留对话上下文，右边是可读的预览结果。\n\n' +
      '关键结论：从 `Connect account` 到 `First successful run` 掉了 **31%**，这一步需要补状态解释和失败恢复入口。\n\n' +
      '```html\n' +
      '<section class="metric">\n' +
      '  <strong>31%</strong>\n' +
      '  <span>drop between connect and first run</span>\n' +
      '</section>\n' +
      '```',
    timestamp: Date.now() - 2 * 60_000,
    turnId: 'desktop-turn-2',
  },
]

const desktopChatSession: Session = {
  id: 'desktop-chat-preview-session',
  workspaceId: 'playground-workspace',
  workspaceName: 'Playground',
  name: 'Onboarding funnel review',
  messages: desktopChatMessages,
  isProcessing: false,
  lastMessageAt: Date.now(),
  permissionMode: 'ask',
  sessionStatus: 'in-progress',
  messageCount: desktopChatMessages.length,
  lastFinalMessageId: 'desktop-assistant-2',
  createdAt: Date.now() - 30 * 60_000,
  workingDirectory: '/Users/demo/projects/craft-agent',
  sessionFolderPath: '/Users/demo/projects/craft-agent/.craft/sessions/desktop-chat-preview-session',
}

const desktopChatSessionMeta: SessionMeta = {
  id: desktopChatSession.id,
  name: desktopChatSession.name,
  workspaceId: desktopChatSession.workspaceId,
  lastMessageAt: desktopChatSession.lastMessageAt,
  sessionStatus: desktopChatSession.sessionStatus,
  labels: ['feature', 'design'],
  lastMessageRole: 'assistant',
  messageCount: desktopChatMessages.length,
  lastFinalMessageId: 'desktop-assistant-2',
  workingDirectory: desktopChatSession.workingDirectory,
}

function DesktopChatHydrateAtoms({ children }: { children: React.ReactNode }) {
  const setMetaMap = useSetAtom(sessionMetaMapAtom)
  const setSession = useSetAtom(sessionAtomFamily(desktopChatSession.id))
  const setLoadedSessions = useSetAtom(loadedSessionsAtom)

  React.useEffect(() => {
    setMetaMap(new Map([[desktopChatSessionMeta.id, desktopChatSessionMeta]]))
    setSession(desktopChatSession)
    setLoadedSessions(new Set([desktopChatSession.id]))
  }, [setLoadedSessions, setMetaMap, setSession])

  return <>{children}</>
}

const desktopPreviewPaths = {
  html: '/Users/demo/projects/craft-agent/.craft/sessions/desktop-chat-preview-session/onboarding-funnel.html',
  markdown: '/Users/demo/projects/craft-agent/.craft/sessions/desktop-chat-preview-session/onboarding-brief.md',
} as const

function DesktopChatAppShellOverride({ children }: { children: React.ReactNode }) {
  const parent = useOptionalAppShellContext()
  React.useEffect(() => {
    ensureMockElectronAPI()
    const electronAPI = (window as any).electronAPI
    const previousReadFile = electronAPI.readFile
    const previousSessionCommand = electronAPI.sessionCommand

    electronAPI.readFile = async (path: string) => {
      if (path === desktopPreviewPaths.html) return previewHtml
      if (path === desktopPreviewPaths.markdown) return previewMarkdown
      return previousReadFile ? previousReadFile(path) : ''
    }
    electronAPI.sessionCommand = async (sessionId: string, command: unknown) => {
      console.log('[Playground] sessionCommand called:', sessionId, command)
      return previousSessionCommand ? previousSessionCommand(sessionId, command) : { success: true }
    }

    return () => {
      electronAPI.readFile = previousReadFile
      electronAPI.sessionCommand = previousSessionCommand
    }
  }, [])

  const value = React.useMemo(
    () => ({
      ...(parent ?? playgroundAppShellContext),
      isCompactMode: false,
      activeWorkspaceId: 'playground-workspace',
      activeWorkspaceSlug: 'playground',
      llmConnections: [
        {
          slug: 'anthropic-playground',
          name: 'Anthropic',
          providerType: 'anthropic' as const,
          authType: 'api_key' as const,
          defaultModel: 'claude-sonnet-4-6',
          isAuthenticated: true,
          createdAt: Date.now() - 86_400_000,
        },
      ],
      onCreateSession: async () => desktopChatSession,
      getDraftAttachmentRefs: () => [],
      hydrateDraftAttachments: async () => [],
      getDraft: () => '',
      onSendMessage: (sessionId: string, message: string) => console.log('[Playground] Send message:', sessionId, message),
      onOpenUrl: (url: string) => console.log('[Playground] Open URL:', url),
      onOpenFile: (path: string) => console.log('[Playground] Open file:', path),
      onSessionSourcesChange: (sessionId: string, slugs: string[]) => console.log('[Playground] Sources changed:', sessionId, slugs),
      onSessionLabelsChange: (sessionId: string, labels: string[]) => console.log('[Playground] Labels changed:', sessionId, labels),
      sessionStatuses: inputContainerSampleStatuses,
      labels: inputContainerSampleLabels,
      enabledSources: mockSources,
      skills: [],
    }),
    [parent],
  )

  return <AppShellProvider value={value as any}>{children}</AppShellProvider>
}

function DesktopChatPlaygroundProviders({ children }: { children: React.ReactNode }) {
  const store = React.useMemo(() => createStore(), [])
  const navigationValue = React.useMemo(() => ({
    navigate: (route: unknown, options?: unknown) => {
      console.log('[Playground] Static navigation requested:', route, options)
    },
    isReady: true,
    navigationState: {
      navigator: 'sessions',
      filter: { kind: 'allSessions' },
      details: { type: 'session', sessionId: desktopChatSession.id },
    } satisfies NavigationState,
    canGoBack: false,
    canGoForward: false,
    goBack: () => {},
    goForward: () => {},
    updateRightSidebar: () => {},
    toggleRightSidebar: () => {},
    navigateToSource: () => {},
    navigateToSession: () => {},
  }), [])

  return (
    <JotaiProvider store={store}>
      <DesktopChatHydrateAtoms>
        <ActionRegistryProvider>
          <DismissibleLayerProvider>
            <ModalProvider>
              <EscapeInterruptProvider>
                <FocusProvider>
                  <NavigationContext.Provider value={navigationValue}>
                    <DesktopChatAppShellOverride>{children}</DesktopChatAppShellOverride>
                  </NavigationContext.Provider>
                </FocusProvider>
              </EscapeInterruptProvider>
            </ModalProvider>
          </DismissibleLayerProvider>
        </ActionRegistryProvider>
      </DesktopChatHydrateAtoms>
    </JotaiProvider>
  )
}

const previewHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #1f2937;
        background: #fbfaf8;
      }
      .page { padding: 28px; }
      .eyebrow { color: #64748b; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      h1 { margin: 8px 0 18px; font-size: 30px; line-height: 1.1; color: #111827; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 18px 0 22px; }
      .metric { border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; background: white; }
      .metric strong { display: block; font-size: 24px; color: #0f766e; }
      .metric span { color: #64748b; font-size: 12px; }
      .section { border-top: 1px solid #e5e7eb; padding-top: 18px; margin-top: 16px; }
      .bar { height: 10px; border-radius: 999px; background: #e5e7eb; overflow: hidden; margin: 9px 0 4px; }
      .bar > span { display: block; height: 100%; background: #0f766e; }
      .row { margin-bottom: 14px; }
      .row label { display: flex; justify-content: space-between; font-size: 13px; font-weight: 650; }
      h2 { margin: 28px 0 10px; font-size: 18px; color: #111827; }
      p, li { color: #475569; font-size: 13px; line-height: 1.55; }
      ul { padding-left: 18px; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
      th, td { border-bottom: 1px solid #e5e7eb; padding: 10px 0; text-align: left; }
      th { color: #64748b; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
      .callout { border-left: 3px solid #0f766e; background: #f0fdfa; padding: 12px 14px; margin-top: 12px; border-radius: 8px; }
      .timeline { display: grid; gap: 12px; margin-top: 12px; }
      .event { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; background: white; }
      .event strong { display: block; color: #111827; margin-bottom: 4px; }
    </style>
  </head>
  <body>
    <main class="page">
      <div class="eyebrow">Activation Review</div>
      <h1>Onboarding loses momentum after account connection</h1>
      <div class="grid">
        <div class="metric"><strong>74%</strong><span>start setup</span></div>
        <div class="metric"><strong>51%</strong><span>connect account</span></div>
        <div class="metric"><strong>20%</strong><span>first successful run</span></div>
      </div>
      <section class="section">
        <div class="row"><label><span>Invite accepted</span><span>91%</span></label><div class="bar"><span style="width: 91%"></span></div></div>
        <div class="row"><label><span>Workspace created</span><span>74%</span></label><div class="bar"><span style="width: 74%"></span></div></div>
        <div class="row"><label><span>Account connected</span><span>51%</span></label><div class="bar"><span style="width: 51%"></span></div></div>
        <div class="row"><label><span>First successful run</span><span>20%</span></label><div class="bar"><span style="width: 20%"></span></div></div>
      </section>
      <section class="section">
        <p><strong>Recommendation:</strong> add an inline recovery card when the first run fails, and keep the user inside the setup flow instead of sending them to settings.</p>
      </section>
      <section class="section">
        <h2>What changed in the long-form review</h2>
        <p>The report is intentionally document-shaped rather than landing-page-shaped. It keeps the operational question visible: where does activation fall apart, and what does the team need to change next?</p>
        <div class="callout">
          <p><strong>Primary issue:</strong> users believe connection is the finish line. The product treats the first successful run as the finish line, but the UI does not make that next step explicit.</p>
        </div>
      </section>
      <section class="section">
        <h2>Funnel diagnostic table</h2>
        <table>
          <thead>
            <tr><th>Step</th><th>Conversion</th><th>Likely friction</th></tr>
          </thead>
          <tbody>
            <tr><td>Invite accepted</td><td>91%</td><td>Clear email and workspace context</td></tr>
            <tr><td>Workspace created</td><td>74%</td><td>Some users pause on naming and team scope</td></tr>
            <tr><td>Account connected</td><td>51%</td><td>OAuth anxiety, unclear permission language</td></tr>
            <tr><td>First successful run</td><td>20%</td><td>No recovery path when credentials or scopes fail</td></tr>
          </tbody>
        </table>
      </section>
      <section class="section">
        <h2>Timeline of the first-run experience</h2>
        <div class="timeline">
          <div class="event"><strong>0:00 - Account connected</strong><p>User sees a success state, but no explanation of what will happen next.</p></div>
          <div class="event"><strong>0:15 - First run begins</strong><p>The system checks permissions and reachable resources. Failures feel like product failure rather than setup feedback.</p></div>
          <div class="event"><strong>0:45 - Recovery moment</strong><p>The user needs one clear retry action, a reason string, and a way to send diagnostics without leaving setup.</p></div>
        </div>
      </section>
      <section class="section">
        <h2>Implementation checklist</h2>
        <ul>
          <li>Add a persistent "First run" step after account connection.</li>
          <li>Render OAuth scope failures as recoverable states.</li>
          <li>Keep retry and diagnostics inside the setup panel.</li>
          <li>Log first-run failure reasons as structured analytics events.</li>
          <li>Run a week-long cohort comparison against the current flow.</li>
        </ul>
      </section>
    </main>
  </body>
</html>`

const previewMarkdown = `# Onboarding Funnel Brief

This is the Markdown companion to the HTML review. It is longer on purpose so the preview panel can exercise real document scrolling, annotations, copy actions, and dense text rhythm.

## Finding

The largest drop happens between **Account connected** and **First successful run**.

| Step | Conversion |
| --- | ---: |
| Invite accepted | 91% |
| Workspace created | 74% |
| Account connected | 51% |
| First successful run | 20% |

## Recommendation

- Explain what the first run is checking.
- Keep failed credentials recoverable inside setup.
- Add one retry CTA and one "send logs" escape hatch.

## Narrative

The current onboarding flow makes account connection feel like completion. That is understandable from the user's point of view: OAuth opens, permission is granted, and the product returns them to a success-looking screen. From the product's point of view, however, the work is not complete until the first run succeeds.

This mismatch creates a fragile moment. When the first run fails, the user has already emotionally moved on from setup. The product then asks them to debug credentials, scopes, or reachable resources without explaining why this extra step exists.

## Funnel Breakdown

| Step | Conversion | Notes |
| --- | ---: | --- |
| Invite accepted | 91% | Email and workspace context are clear. |
| Workspace created | 74% | Naming and team scope create mild hesitation. |
| Account connected | 51% | Permission language needs more confidence. |
| First successful run | 20% | This is the primary drop-off. |

## Recovery Design

The failed-run state should stay inside setup and answer three questions:

1. What did the product try to do?
2. Why did it fail?
3. What is the smallest next action?

Recommended UI:

- A compact failure card under the first-run step.
- A retry button as the primary action.
- A secondary "send diagnostics" action.
- A link to permissions only when the error is specifically scope-related.

## Analytics Events

Capture these events for the next cohort:

- \`setup_first_run_started\`
- \`setup_first_run_succeeded\`
- \`setup_first_run_failed\`
- \`setup_first_run_retry_clicked\`
- \`setup_diagnostics_sent\`

Each failure event should include a normalized reason, provider, connection age, and whether the user had already left and returned to setup.

## Open Questions

- Should a successful test run be required before the user reaches the main app?
- Do we need provider-specific copy for GitHub, Google Drive, and Linear?
- Can we infer missing scopes before the first run?
- Should diagnostics be sent to support, workspace admins, or both?

## Next Steps

- Prototype the failure card in the setup panel.
- Run five usability sessions with intentionally broken OAuth scopes.
- Ship analytics first, then UI treatment.
- Review cohort movement after one week.
`

type DesktopChatPreviewMode = 'html' | 'markdown'
type DesktopChatPreviewSurface = 'flush' | 'raised'

interface PreviewResourcePanelProps {
  resourceDetails: SessionResourceDetails
  previewSurface: DesktopChatPreviewSurface
}

function PreviewResourcePanel({
  resourceDetails,
  previewSurface,
}: PreviewResourcePanelProps) {
  const surfaceClassName = cn(
    'h-full min-h-0',
    previewSurface === 'flush' && '[&_.bg-foreground-3]:bg-background [&_.shadow-strong]:shadow-middle'
  )

  return (
    <div className={surfaceClassName}>
      <SessionResourcePreviewPage resourceDetails={resourceDetails} />
    </div>
  )
}

function DesktopChatWithPreview({
  previewMode = 'html',
  previewSurface = 'flush',
}: {
  previewMode?: DesktopChatPreviewMode
  previewSurface?: DesktopChatPreviewSurface
}) {
  const [mode, setMode] = React.useState<PermissionMode>('ask')
  const [model, setModel] = React.useState('claude-sonnet-4-6')
  const [input, setInput] = React.useState('')

  const resourceDetails = React.useMemo<SessionResourceDetails>(() => ({
    type: 'resource',
    sessionId: desktopChatSession.id,
    resource: {
      kind: 'file',
      target: previewMode === 'html' ? desktopPreviewPaths.html : desktopPreviewPaths.markdown,
    },
  }), [previewMode])

  return (
    <DesktopChatPlaygroundProviders>
      <div className="h-full w-full bg-background p-2">
        <div className="flex h-full min-h-0 gap-[6px] overflow-hidden">
          <section className="min-w-[460px] flex-[1.05] overflow-hidden rounded-[10px] border border-border bg-background shadow-middle">
            <ChatDisplay
              session={desktopChatSession}
              onSendMessage={(message) => console.log('[Playground] Desktop chat send:', message)}
              onOpenFile={(path) => console.log('[Playground] Open file:', path)}
              onOpenUrl={(url) => console.log('[Playground] Open URL:', url)}
              currentModel={model}
              onModelChange={setModel}
              permissionMode={mode}
              onPermissionModeChange={setMode}
              inputValue={input}
              onInputChange={setInput}
              sources={mockSources}
              onSourcesChange={(slugs) => console.log('[Playground] Sources changed:', slugs)}
              skills={[]}
              labels={inputContainerSampleLabels}
              onLabelsChange={(labels) => console.log('[Playground] Labels changed:', labels)}
              sessionStatuses={inputContainerSampleStatuses}
              onSessionStatusChange={(state) => console.log('[Playground] Status changed:', state)}
              workspaceId="playground-workspace"
              workingDirectory="/Users/demo/projects/craft-agent"
              onWorkingDirectoryChange={(path) => console.log('[Playground] Working directory changed:', path)}
              sessionFolderPath="/Users/demo/projects/craft-agent/.craft/sessions/desktop-chat-preview-session"
            />
          </section>

          <section className="min-w-[420px] flex-[0.95] overflow-hidden rounded-[10px] border border-border bg-background shadow-middle">
            <PreviewResourcePanel
              resourceDetails={resourceDetails}
              previewSurface={previewSurface}
            />
          </section>
        </div>
      </div>
    </DesktopChatPlaygroundProviders>
  )
}

/**
 * Interactive test component for Permission UI ↔ Input View animation transitions
 * Allows toggling between states to inspect the animate in/out behavior
 */
interface PermissionInputToggleProps {
  autoToggle?: boolean
  autoToggleInterval?: number
  useLongCommand?: boolean
}

function PermissionInputToggle({ autoToggle = false, autoToggleInterval = 3000, useLongCommand = false }: PermissionInputToggleProps) {
  const [showPermission, setShowPermission] = React.useState(false)
  const [permissionMode, setPermissionMode] = React.useState<PermissionMode>('ask')

  const permissionRequest = useLongCommand ? veryLongPermissionRequest : samplePermissionRequest

  // Auto-toggle for continuous animation testing
  React.useEffect(() => {
    if (!autoToggle) return
    const interval = setInterval(() => {
      setShowPermission(prev => !prev)
    }, autoToggleInterval)
    return () => clearInterval(interval)
  }, [autoToggle, autoToggleInterval])

  // Inject mock electronAPI for file attachments
  React.useEffect(() => {
    ensureMockElectronAPI()
  }, [])

  const handlePermissionResponse = (response: StructuredResponse) => {
    console.log('[Playground] Structured response:', response)
    setShowPermission(false)
  }

  // Build structuredInput state for real InputContainer
  const structuredInput = showPermission ? {
    type: 'permission' as const,
    data: permissionRequest,
  } : undefined

  return (
    <div className="w-full max-w-[960px] h-full flex flex-col px-4 pb-4">
      {/* Spacer to push content to bottom */}
      <div className="flex-1" />

      {/* Control buttons */}
      <div className="flex items-center gap-2 mb-20">
        <Button
          variant={showPermission ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowPermission(true)}
          className="gap-1.5"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Show Permission
        </Button>
        <Button
          variant={!showPermission ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowPermission(false)}
          className="gap-1.5"
        >
          Show Input
        </Button>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">
          Current: <span className="font-medium">{showPermission ? 'Permission Banner' : 'Input View'}</span>
        </span>
      </div>

      {/* Active option badges */}
      <ActiveOptionBadges
        permissionMode={permissionMode}
        onPermissionModeChange={setPermissionMode}
      />

      {/* Real InputContainer - handles animation automatically */}
      <InputContainer
        placeholder="Message Craft Agent..."
        disabled={false}
        isProcessing={false}
        currentModel="claude-sonnet-4-6"
        permissionMode={permissionMode}
        onPermissionModeChange={setPermissionMode}
        sources={mockSources}
        enabledSourceSlugs={['github-api', 'local-files']}
        workingDirectory="/Users/demo/projects/craft-agent"
        sessionId="playground-session"
        structuredInput={structuredInput}
        onStructuredResponse={handlePermissionResponse}
        onSubmit={mockInputCallbacks.onSubmit}
        onModelChange={mockInputCallbacks.onModelChange}
        onInputChange={mockInputCallbacks.onInputChange}
        onHeightChange={mockInputCallbacks.onHeightChange}
        onFocusChange={mockInputCallbacks.onFocusChange}
        onSourcesChange={mockInputCallbacks.onSourcesChange}
        onWorkingDirectoryChange={mockInputCallbacks.onWorkingDirectoryChange}
        onStop={mockInputCallbacks.onStop}
      />
    </div>
  )
}

// Generate variants for all hints dynamically
const emptyStateHintVariants = Array.from({ length: getHintCount() }, (_, i) => ({
  name: `Hint ${i + 1}`,
  description: getHintTemplate(i).slice(0, 50) + '...',
  props: { hintIndex: i },
}))

export const chatComponents: ComponentEntry[] = [
  {
    id: 'empty-state-hint',
    name: 'EmptyStateHint',
    category: 'Chat',
    description: 'Rotating workflow suggestions for empty chat state with inline entity badges (sources, files, folders, skills)',
    component: EmptyStateHint,
    props: [
      {
        name: 'hintIndex',
        description: 'Specific hint to display (0-14). Leave empty for random.',
        control: { type: 'number', min: 0, max: 14, step: 1 },
        defaultValue: 0,
      },
    ],
    variants: emptyStateHintVariants,
    mockData: () => ({}),
  },
  {
    id: 'attachment-preview',
    name: 'AttachmentPreview',
    category: 'Chat',
    description: 'ChatGPT-style attachment preview strip showing attached files as bubbles above textarea',
    component: AttachmentPreview,
    props: [
      {
        name: 'disabled',
        description: 'Disable remove buttons',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'loadingCount',
        description: 'Number of loading placeholders to show',
        control: { type: 'number', min: 0, max: 5, step: 1 },
        defaultValue: 0,
      },
    ],
    variants: [
      { name: 'Empty', props: { attachments: [], loadingCount: 0 } },
      { name: 'With Images', props: { attachments: [sampleImageAttachment, sampleImageAttachment] } },
      { name: 'With Documents', props: { attachments: [samplePdfAttachment, sampleCodeAttachment] } },
      { name: 'Mixed', props: { attachments: [sampleImageAttachment, samplePdfAttachment, sampleCodeAttachment] } },
      { name: 'Loading', props: { attachments: [], loadingCount: 3 } },
      { name: 'Disabled', props: { attachments: [sampleImageAttachment, samplePdfAttachment], disabled: true } },
    ],
    mockData: () => ({
      attachments: [sampleImageAttachment, samplePdfAttachment],
      onRemove: mockAttachmentCallbacks.onRemove,
    }),
  },
  {
    id: 'setup-auth-banner',
    name: 'SetupAuthBanner',
    category: 'Chat',
    description: 'Shows when an agent needs activation or authentication',
    component: SetupAuthBanner,
    props: [
      {
        name: 'state',
        description: 'Banner state',
        control: {
          type: 'select',
          options: [
            { label: 'Hidden', value: 'hidden' },
            { label: 'MCP Auth', value: 'mcp_auth' },
            { label: 'API Auth', value: 'api_auth' },
            { label: 'Error', value: 'error' },
          ],
        },
        defaultValue: 'mcp_auth',
      },
      {
        name: 'reason',
        description: 'Custom reason message',
        control: { type: 'string', placeholder: 'Optional custom reason' },
        defaultValue: '',
      },
    ],
    variants: [
      { name: 'MCP Auth', props: { state: 'mcp_auth' } },
      { name: 'API Auth', props: { state: 'api_auth' } },
      { name: 'Custom Reason', props: { state: 'api_auth', reason: 'Your OAuth token has expired. Please re-authenticate to continue.' } },
      { name: 'Error', props: { state: 'error' } },
      { name: 'Hidden', props: { state: 'hidden' } },
    ],
    mockData: () => ({
      onAction: () => console.log('[Playground] Setup/Auth action clicked'),
    }),
  },
  {
    id: 'active-option-badges',
    name: 'ActiveOptionBadges',
    category: 'Chat',
    description: 'Shows active options (permission mode) and background tasks as badge pills above chat input',
    component: ActiveOptionBadges,
    props: [
      {
        name: 'permissionMode',
        description: 'Current permission mode',
        control: {
          type: 'select',
          options: [
            { label: 'Safe Mode', value: 'safe' },
            { label: 'Ask Permission', value: 'ask' },
            { label: 'Allow All', value: 'allow-all' },
          ],
        },
        defaultValue: 'ask',
      },
      {
        name: 'variant',
        description: 'Interaction variant',
        control: {
          type: 'select',
          options: [
            { label: 'Dropdown', value: 'dropdown' },
            { label: 'Cycle', value: 'cycle' },
          ],
        },
        defaultValue: 'dropdown',
      },
    ],
    variants: [
      { name: 'Permission Mode (Ask)', props: { permissionMode: 'ask', tasks: [], sessionId: 'session-1' } },
      { name: 'Permission Mode (Safe)', props: { permissionMode: 'safe', tasks: [], sessionId: 'session-1' } },
      { name: 'Permission Mode (Allow All)', props: { permissionMode: 'allow-all', tasks: [], sessionId: 'session-1' } },
      { name: 'Single Task', props: { permissionMode: 'ask', tasks: singleBackgroundTask, sessionId: 'session-1' } },
      { name: 'Multiple Tasks', props: { permissionMode: 'ask', tasks: sampleBackgroundTasks, sessionId: 'session-1' } },
      { name: 'Long Running Tasks', props: { permissionMode: 'ask', tasks: longRunningTasks, sessionId: 'session-1' } },
      { name: 'All Active (Everything)', props: { permissionMode: 'ask', tasks: sampleBackgroundTasks, sessionId: 'session-1' } },
      { name: 'Tasks in Safe Mode', props: { permissionMode: 'safe', tasks: sampleBackgroundTasks, sessionId: 'session-1' } },
      { name: 'Cycle Variant', props: { permissionMode: 'ask', tasks: sampleBackgroundTasks, variant: 'cycle', sessionId: 'session-1' } },
    ],
    mockData: () => ({
      tasks: sampleBackgroundTasks,
      sessionId: 'session-playground',
      onPermissionModeChange: (mode: string) => console.log('[Playground] Permission mode changed:', mode),
      onKillTask: (taskId: string) => console.log('[Playground] Kill task:', taskId),
    }),
  },
  {
    id: 'permission-input-toggle',
    name: 'Permission ↔ Input Toggle',
    category: 'Chat',
    description: 'Interactive test for animating between Permission Banner and Input View. Click buttons to toggle states and inspect animations.',
    component: PermissionInputToggle,
    props: [
      {
        name: 'useLongCommand',
        description: 'Use a very long multi-line command',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'autoToggle',
        description: 'Automatically toggle between states',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'autoToggleInterval',
        description: 'Auto-toggle interval in milliseconds',
        control: { type: 'number', min: 1000, max: 10000, step: 500 },
        defaultValue: 3000,
      },
    ],
    variants: [
      { name: 'Short Command', props: { useLongCommand: false } },
      { name: 'Long Command (10+ lines)', props: { useLongCommand: true } },
      { name: 'Auto Toggle', props: { autoToggle: true, autoToggleInterval: 2000 } },
    ],
    mockData: () => ({}),
  },
  {
    id: 'turn-card-flat',
    name: 'TurnCard (Flat Tools)',
    category: 'Turn Cards',
    description: 'TurnCard with flat tool hierarchy - no nesting, all tools at root level',
    component: TurnCard,
    props: [],
    variants: [
      { name: 'Default', props: {} },
    ],
    mockData: () => ({
      activities: flatActivities,
      response: { text: 'I found the pattern across the codebase and made the necessary edits.', isStreaming: false },
      isStreaming: false,
      isComplete: true,
    }),
  },
  {
    id: 'turn-card-nested-complete',
    name: 'TurnCard (Nested - Complete)',
    category: 'Turn Cards',
    description: 'TurnCard showing Task subagent with completed child tools - vertical line tree view',
    component: TurnCard,
    props: [],
    variants: [
      { name: 'Default', props: {} },
    ],
    mockData: () => ({
      activities: nestedActivitiesCompleted,
      response: { text: 'Exploration complete. I found 24 React components with 156 exported functions. The codebase follows a modular pattern.', isStreaming: false },
      isStreaming: false,
      isComplete: true,
    }),
  },
  {
    id: 'turn-card-nested-progress',
    name: 'TurnCard (Nested - In Progress)',
    category: 'Turn Cards',
    description: 'TurnCard showing Task subagent with child tools still running',
    component: TurnCard,
    props: [],
    variants: [
      { name: 'Default', props: {} },
    ],
    mockData: () => ({
      activities: nestedActivitiesInProgress,
      isStreaming: true,
      isComplete: false,
    }),
  },
  {
    id: 'turn-card-multi-task',
    name: 'TurnCard (Multiple Tasks)',
    category: 'Turn Cards',
    description: 'TurnCard showing multiple sequential Task subagents, each with their own child tools',
    component: TurnCard,
    props: [],
    variants: [
      { name: 'Default', props: {} },
    ],
    mockData: () => ({
      activities: multipleNestedTasks,
      response: { text: 'Analysis and fixes complete. I found 23 TODO/FIXME issues, removed deprecated code, and created a modern replacement component.', isStreaming: false },
      isStreaming: false,
      isComplete: true,
    }),
  },
  {
    id: 'turn-card-deep-nested',
    name: 'TurnCard (Deep Nesting)',
    category: 'Turn Cards',
    description: 'TurnCard showing 2+ levels of nesting - Task containing another Task with tools',
    component: TurnCard,
    props: [],
    variants: [
      { name: 'Default', props: {} },
    ],
    mockData: () => ({
      activities: deepNestedActivities,
      response: { text: 'Authentication refactoring complete. I implemented OAuth with PKCE, created a callback handler, and all tests pass.', isStreaming: false },
      isStreaming: false,
      isComplete: true,
    }),
  },
  {
    id: 'active-tasks-bar-context',
    name: 'Active Tasks & Badges',
    category: 'Chat',
    description: 'Integrated display of option badges (permission mode) and background tasks in a horizontally scrollable row. Shows full chat context with messages above and input below.',
    component: ActiveTasksBarContext,
    layout: 'full',
    props: [],
    variants: [
      { name: 'With Multiple Tasks', props: { tasks: sampleBackgroundTasks } },
      { name: 'With Single Task', props: { tasks: singleBackgroundTask } },
      { name: 'With Long Running Tasks', props: { tasks: longRunningTasks } },
      { name: 'Empty (Hidden)', props: { tasks: [] } },
    ],
    mockData: () => ({
      tasks: sampleBackgroundTasks,
    }),
  },
  {
    id: 'desktop-chat-with-preview',
    name: 'Desktop Chat + Preview',
    category: 'Chat',
    description: 'Full desktop chat surface with the production ChatDisplay on the left and HTML/Markdown preview panel on the right.',
    component: DesktopChatWithPreview,
    layout: 'full',
    previewOverflow: 'hidden',
    props: [
      {
        name: 'previewMode',
        description: 'Initial preview panel mode',
        control: {
          type: 'select',
          options: [
            { label: 'HTML', value: 'html' },
            { label: 'Markdown', value: 'markdown' },
          ],
        },
        defaultValue: 'html',
      },
      {
        name: 'previewSurface',
        description: 'Preview content background treatment',
        control: {
          type: 'select',
          options: [
            { label: 'Flush with panel', value: 'flush' },
            { label: 'Raised canvas', value: 'raised' },
          ],
        },
        defaultValue: 'flush',
      },
    ],
    variants: [
      { name: 'HTML · Flush', props: { previewMode: 'html', previewSurface: 'flush' } },
      { name: 'Markdown · Flush', props: { previewMode: 'markdown', previewSurface: 'flush' } },
      { name: 'HTML · Raised', props: { previewMode: 'html', previewSurface: 'raised' } },
      { name: 'Markdown · Raised', props: { previewMode: 'markdown', previewSurface: 'raised' } },
    ],
    mockData: () => ({}),
  },
  {
    id: 'input-container',
    name: 'InputContainer',
    category: 'Chat Inputs',
    description: 'App-like input zone with max-width layout, active option badges, labels, statuses, tasks, and full InputContainer behavior',
    component: InputContainerPlayground,
    layout: 'full',
    previewOverflow: 'visible',
    props: [
      {
        name: 'inputMode',
        description: 'Input mode rendered by InputContainer',
        control: {
          type: 'select',
          options: [
            { label: 'Freeform', value: 'freeform' },
            { label: 'Permission', value: 'permission' },
            { label: 'Admin Approval', value: 'admin_approval' },
          ],
        },
        defaultValue: 'freeform',
      },
      {
        name: 'disabled',
        description: 'Disable all inputs',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'isProcessing',
        description: 'Show processing state (disables send, shows stop)',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'compactMode',
        description: 'Compact mode used by embedded editors/popovers',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'placeholder',
        description: 'Textarea placeholder text',
        control: { type: 'string', placeholder: 'Message...' },
        defaultValue: 'Message Craft Agent...',
      },
      {
        name: 'currentModel',
        description: 'Current selected model',
        control: {
          type: 'select',
          options: [
            { label: 'Opus 4.8', value: 'claude-opus-4-8' },
            { label: 'Opus 4.7', value: 'claude-opus-4-7' },
            { label: 'Sonnet 4.6', value: 'claude-sonnet-4-6' },
            { label: 'Haiku 3.5', value: 'claude-3-5-haiku-20241022' },
          ],
        },
        defaultValue: 'claude-sonnet-4-6',
      },
      {
        name: 'permissionMode',
        description: 'Permission mode badge',
        control: {
          type: 'select',
          options: [
            { label: 'Safe (read-only)', value: 'safe' },
            { label: 'Ask (prompt)', value: 'ask' },
            { label: 'Allow All', value: 'allow-all' },
          ],
        },
        defaultValue: 'ask',
      },
      {
        name: 'showOptionBadges',
        description: 'Show the ActiveOptionBadges row above input',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'showTasks',
        description: 'Include background tasks in badges row',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'showLabels',
        description: 'Include label badges and value editing',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'labelCount',
        description: 'Number of label configs to show',
        control: { type: 'number', min: 1, max: 4, step: 1 },
        defaultValue: 3,
      },
      {
        name: 'showStatuses',
        description: 'Include session status badge and menu',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'showSources',
        description: 'Enable sources selector badge and source mentions',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'sourceCount',
        description: 'How many sources are available in selector',
        control: { type: 'number', min: 1, max: 4, step: 1 },
        defaultValue: 2,
      },
      {
        name: 'showWorkingDirectory',
        description: 'Show working directory context badge',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'workingDirectory',
        description: 'Current working directory',
        control: { type: 'string', placeholder: '/path/to/project' },
        defaultValue: '/Users/demo/projects/craft-agent',
      },
      {
        name: 'seedRecentDirs',
        description: 'Seed recent working directory history in playground local storage',
        control: { type: 'boolean' },
        defaultValue: true,
      },
      {
        name: 'recentDirScenario',
        description: 'Fixture set used for recent working directory history',
        control: {
          type: 'select',
          options: [
            { label: 'Few (3 items)', value: 'few' },
            { label: 'Many (9 items + filter)', value: 'many' },
            { label: 'None (empty)', value: 'none' },
          ],
        },
        defaultValue: 'few',
      },
      {
        name: 'showAttachments',
        description: 'Show preloaded attachment chips above editor',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'attachmentCount',
        description: 'Number of preloaded attachments to preview',
        control: { type: 'number', min: 1, max: 3, step: 1 },
        defaultValue: 2,
      },
      {
        name: 'showFollowUps',
        description: 'Show follow-up annotation chips above editor',
        control: { type: 'boolean' },
        defaultValue: false,
      },
      {
        name: 'followUpCount',
        description: 'Number of follow-up chips to preview',
        control: { type: 'number', min: 1, max: 4, step: 1 },
        defaultValue: 2,
      },
    ],
    mockData: () => ({}),
    variants: [
      {
        name: 'Default (Comprehensive)',
        description: 'App-like full setup with badges, labels, statuses, sources, and working directory',
        props: {},
      },
      {
        name: 'Working Dir History (Few)',
        description: 'Recent working directory list with a few entries (remove button testing)',
        props: {
          showWorkingDirectory: true,
          seedRecentDirs: true,
          recentDirScenario: 'few',
        },
      },
      {
        name: 'Working Dir History (Many + Filter)',
        description: 'Recent working directory list with many entries to trigger filter input path',
        props: {
          showWorkingDirectory: true,
          seedRecentDirs: true,
          recentDirScenario: 'many',
        },
      },
      {
        name: 'Working Dir History (Empty)',
        description: 'No recent directory history (empty state)',
        props: {
          showWorkingDirectory: true,
          seedRecentDirs: true,
          recentDirScenario: 'none',
        },
      },
      {
        name: 'Minimal',
        description: 'Input only — no badges, no sources, no cwd badge',
        props: {
          showOptionBadges: false,
          showSources: false,
          showWorkingDirectory: false,
        },
      },
      {
        name: 'Processing + Tasks',
        description: 'Streaming/processing state with background task badges',
        props: {
          isProcessing: true,
          showTasks: true,
          showOptionBadges: true,
        },
      },
      {
        name: 'Safe + Compact',
        description: 'Explore mode style in compact embedding',
        props: {
          permissionMode: 'safe',
          compactMode: true,
          showTasks: false,
        },
      },
      {
        name: 'Permission Mode UI',
        description: 'Structured permission request replaces freeform input',
        props: {
          inputMode: 'permission',
          showFollowUps: false,
        },
      },
      {
        name: 'Admin Approval UI',
        description: 'Structured admin approval request state',
        props: {
          inputMode: 'admin_approval',
          showFollowUps: false,
        },
      },
      {
        name: 'Label-heavy Review',
        description: 'Many labels + status for metadata density checks',
        props: {
          showLabels: true,
          labelCount: 4,
          showStatuses: true,
          showTasks: false,
        },
      },
      {
        name: 'Source-heavy Review',
        description: 'Multiple source avatars and source selector stress test',
        props: {
          showSources: true,
          sourceCount: 4,
          showWorkingDirectory: false,
        },
      },
      {
        name: 'Follow-up Review',
        description: 'Follow-up annotation chips visible in input',
        props: {
          showFollowUps: true,
          followUpCount: 3,
        },
      },
      {
        name: 'Attachments + Follow-ups',
        description: 'Preloaded attachments with follow-up annotation chips visible together',
        props: {
          showAttachments: true,
          attachmentCount: 2,
          showFollowUps: true,
          followUpCount: 3,
        },
      },
      {
        name: 'Disabled',
        description: 'Fully disabled state',
        props: {
          disabled: true,
        },
      },
    ],
  },
]

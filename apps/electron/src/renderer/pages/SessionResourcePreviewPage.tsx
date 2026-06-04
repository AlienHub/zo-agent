import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  ImagePreviewOverlay,
  MarkdownActionBar,
  PDFPreviewOverlay,
  Spinner,
  AnnotatableMarkdownDocument,
  classifyFile,
} from '@craft-agent/ui'
import { useSetAtom } from 'jotai'
import { AlertCircle, ChevronDown, Copy, ExternalLink, FileText, FolderOpen, Globe, Monitor } from 'lucide-react'
import { useNavigationState, isSessionsNavigation } from '@/contexts/NavigationContext'
import { routes } from '@/lib/navigate'
import { navigate } from '@/lib/navigate'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import { useAppShellContext, useSession as useSessionData } from '@/context/AppShellContext'
import { normalizeLocalFileTarget } from '@/lib/file-link-target'
import {
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { toast } from 'sonner'
import { getFileManagerName } from '@/lib/platform'
import type { AnnotationV1, SessionResourceDetails, SessionResourceRef } from '../../shared/types'
import { cn } from '@/lib/utils'
import { stripMarkdown } from '../utils/text'
import { openInAppBrowser } from '@/lib/browser-pane'
import { ensureSessionMessagesLoadedAtom } from '@/atoms/sessions'

interface SessionResourcePreviewPageProps {
  resourceDetails: SessionResourceDetails
}

function getFileTitle(path: string): string {
  const trimmed = path.trim()
  const normalized = trimmed.replace(/\/+$/, '')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || trimmed
}

function resolveRelativePath(baseFilePath: string, nextPath: string): string {
  if (
    nextPath.startsWith('/') ||
    nextPath.startsWith('~/') ||
    nextPath.startsWith('file:') ||
    /^[a-z]+:\/\//i.test(nextPath)
  ) {
    return nextPath
  }

  const slashIndex = baseFilePath.lastIndexOf('/')
  if (slashIndex === -1) return nextPath
  const baseDir = baseFilePath.slice(0, slashIndex)
  return `${baseDir}/${nextPath.replace(/^\.\//, '')}`
}

function getUrlTitle(target: string): string {
  try {
    const parsed = new URL(target)
    return parsed.hostname || parsed.href
  } catch {
    return target
  }
}

function getUrlDisplay(target: string): string {
  try {
    const parsed = new URL(target)
    return parsed.href
  } catch {
    return target
  }
}

function getResourceAnnotationMessageId(resource: SessionResourceRef): string {
  return `resource:${resource.kind}:${resource.target}`
}

function getResourceSourceLabel(resource: SessionResourceRef): string {
  return resource.kind === 'file' ? resource.target : getUrlDisplay(resource.target)
}

function escapeMarkdownFence(content: string): string {
  return content.replace(/```/g, '``\\`')
}

function getExtension(path: string): string {
  const basename = path.split('/').pop() ?? path
  const dotIndex = basename.lastIndexOf('.')
  if (dotIndex === -1 || dotIndex === 0) return ''
  return basename.slice(dotIndex + 1).toLowerCase()
}

function formatTextFileForAnnotation(content: string, target: string, type: string | null): string {
  if (type === 'markdown') return content
  const language = type === 'json' ? 'json' : type === 'code' ? getExtension(target) : ''
  const fenceInfo = language ? language.replace(/[^a-z0-9_-]/gi, '') : ''
  return ['```' + fenceInfo, escapeMarkdownFence(content), '```'].join('\n')
}

function formatResourceFollowUpMessage(params: {
  resource: SessionResourceRef
  note: string
  selectedText: string
}): string {
  const quoteText = params.selectedText.replace(/\s+/g, ' ').trim()
  return [
    '**Follow-ups**',
    '',
    `> [#1] Source: \`${getResourceSourceLabel(params.resource)}\``,
    `> ${quoteText}`,
    `→ ${params.note}`,
  ].join('\n')
}

function injectHtmlPreviewBase(html: string, sourcePath: string): string {
  const baseHref = getHtmlPreviewBaseHref(sourcePath)
  if (!baseHref || /<base\s/i.test(html)) return html
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1<base href="${baseHref}">`)
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/(<html[^>]*>)/i, `$1<head><base href="${baseHref}"></head>`)
  }
  return `<head><base href="${baseHref}"></head>${html}`
}

function getHtmlPreviewBaseHref(sourcePath: string): string | null {
  if (/^file:/i.test(sourcePath)) {
    try {
      const parsed = new URL(sourcePath)
      parsed.search = ''
      parsed.hash = ''
      parsed.pathname = parsed.pathname.replace(/[^/]*$/, '')
      return parsed.toString()
    } catch {
      return null
    }
  }

  const normalized = sourcePath.replace(/\\/g, '/')
  const slashIndex = normalized.lastIndexOf('/')
  if (slashIndex === -1) return null

  const directory = normalized.slice(0, slashIndex + 1)
  const encoded = encodeURI(directory)

  if (/^[A-Za-z]:\//.test(directory)) {
    return `file:///${encoded}`
  }

  if (directory.startsWith('/')) {
    return `file://${encoded}`
  }

  return null
}

interface CompactResourceMenuProps {
  title: string
  children: (close: () => void) => React.ReactNode
}

interface CompactResourceMenuItemProps {
  icon: React.ReactNode
  label: string
  onClick: () => void | Promise<void>
  destructive?: boolean
}

function CompactResourceMenuItem({
  icon,
  label,
  onClick,
  destructive = false,
}: CompactResourceMenuItemProps) {
  return (
    <button
      type="button"
      onClick={() => { void onClick() }}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors',
        destructive
          ? 'text-destructive hover:bg-destructive/5'
          : 'text-foreground hover:bg-foreground/[0.03]',
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
    </button>
  )
}

function CompactResourceMenu({ title, children }: CompactResourceMenuProps) {
  const [open, setOpen] = React.useState(false)
  const close = React.useCallback(() => setOpen(false), [])

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-md titlebar-no-drag min-w-0',
            'hover:bg-foreground/[0.03] transition-colors',
            'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            'data-[state=open]:bg-foreground/[0.03]',
          )}
          aria-label={title}
        >
          <div className="flex items-center gap-1 min-w-0">
            <h1 className="text-sm font-semibold truncate font-sans leading-tight">{title}</h1>
          </div>
          <span className="shrink-0 flex items-center justify-center">
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground translate-y-[1px]" />
          </span>
        </button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
        </DrawerHeader>
        <div className="px-3 pb-4">
          <div className="overflow-hidden rounded-[12px] border border-border/40 bg-background shadow-minimal">
            {children(close)}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

export default function SessionResourcePreviewPage({
  resourceDetails,
}: SessionResourcePreviewPageProps) {
  const { t } = useTranslation()
  const { rightSidebarButton, leadingAction, onOpenUrl, onSendMessage, isCompactMode } = useAppShellContext()
  const ensureSessionMessagesLoaded = useSetAtom(ensureSessionMessagesLoadedAtom)
  const session = useSessionData(resourceDetails.sessionId)
  const navigationState = useNavigationState()
  const sessionFilter = React.useMemo(() => (
    isSessionsNavigation(navigationState)
      ? navigationState.filter
      : { kind: 'allSessions' as const }
  ), [navigationState])

  const [textContent, setTextContent] = React.useState<string | null>(null)
  const [jsonData, setJsonData] = React.useState<unknown>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [copiedText, setCopiedText] = React.useState(false)
  const resourceKind = resourceDetails.resource.kind
  const resourceTarget = resourceDetails.resource.target

  const resource = React.useMemo(() => (
    resourceKind === 'file'
      ? {
          ...resourceDetails.resource,
          target: normalizeLocalFileTarget(resourceTarget),
        }
      : resourceDetails.resource
  ), [resourceDetails.resource, resourceKind, resourceTarget])
  const classification = React.useMemo(
    () => (resource.kind === 'file' ? classifyFile(resource.target) : null),
    [resource.kind, resource.target]
  )
  const classificationType = classification?.type ?? null
  const canPreview = classification?.canPreview ?? false
  const supportsLiveBrowser = resource.kind === 'url' || classificationType === 'html'
  const resourceRef = React.useMemo<SessionResourceRef>(() => ({
    kind: resource.kind,
    target: resource.target,
  }), [resource.kind, resource.target])
  const resourceAnnotationMessageId = React.useMemo(
    () => getResourceAnnotationMessageId(resourceRef),
    [resourceRef]
  )
  const resourceAnnotations = React.useMemo(() => {
    return session?.resourceAnnotations?.find(group =>
      group.resource.kind === resourceRef.kind && group.resource.target === resourceRef.target
    )?.annotations ?? []
  }, [resourceRef, session?.resourceAnnotations])

  React.useEffect(() => {
    void ensureSessionMessagesLoaded(resourceDetails.sessionId)
  }, [ensureSessionMessagesLoaded, resourceDetails.sessionId])

  const openResourcePanel = React.useCallback((kind: 'file' | 'url', target: string) => {
    navigate(routes.view.sessionResource({
      sessionId: resourceDetails.sessionId,
      resourceKind: kind,
      target,
      filter: sessionFilter,
    }), { newPanel: true })
  }, [resourceDetails.sessionId, sessionFilter])

  const handleNestedFileClick = React.useCallback((path: string) => {
    const resolvedPath = resource.kind === 'file'
      ? resolveRelativePath(resource.target, path)
      : path
    openResourcePanel('file', resolvedPath)
  }, [openResourcePanel, resource])

  const handleNestedUrlClick = React.useCallback((url: string) => {
    onOpenUrl(url)
  }, [onOpenUrl])

  React.useEffect(() => {
    if (resource.kind !== 'file') {
      setTextContent(null)
      setJsonData(null)
      setLoadError(null)
      setIsLoading(false)
      return
    }

    if (!canPreview || !classificationType) {
      setTextContent(null)
      setJsonData(null)
      setLoadError(null)
      setIsLoading(false)
      return
    }

    if (!['html', 'code', 'markdown', 'json', 'text'].includes(classificationType)) {
      setTextContent(null)
      setJsonData(null)
      setLoadError(null)
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setLoadError(null)

    window.electronAPI.readFile(resource.target)
      .then((content) => {
        if (cancelled) return
        setTextContent(content)
        if (classificationType === 'json') {
          try {
            setJsonData(JSON.parse(content))
          } catch (error) {
            setJsonData(null)
            setLoadError(error instanceof Error ? error.message : 'Failed to parse JSON')
          }
        } else {
          setJsonData(null)
        }
      })
      .catch((error) => {
        if (cancelled) return
        setTextContent(null)
        setJsonData(null)
        setLoadError(error instanceof Error ? error.message : 'Failed to read file')
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [resource.kind, resource.target, canPreview, classificationType])

  const openExternally = React.useCallback(() => {
    if (resource.kind === 'file') {
      // eslint-disable-next-line craft-links/no-direct-file-open -- explicit "Open" action should bypass in-panel preview.
      void window.electronAPI.openFile(resource.target)
      return
    }

    void window.electronAPI.openUrl(resource.target)
  }, [resource])

  const handleOpenInNewWindow = React.useCallback(async () => {
    const route = routes.view.sessionResource({
      sessionId: resourceDetails.sessionId,
      resourceKind: resource.kind,
      target: resource.target,
      filter: sessionFilter,
    })
    const separator = route.includes('?') ? '&' : '?'
    const url = `craftagents://${route}${separator}window=focused`
    try {
      await window.electronAPI.openUrl(url)
    } catch (error) {
      console.error('[SessionResourcePreviewPage] openUrl failed:', error)
    }
  }, [resource.kind, resource.target, resourceDetails.sessionId, sessionFilter])

  const handleCopyPath = React.useCallback(async () => {
    await navigator.clipboard.writeText(resource.target)
    toast.success(resource.kind === 'file' ? t('toast.pathCopied') : t('toast.linkCopied'))
  }, [resource, t])

  const handleShowInFinder = React.useCallback(async () => {
    if (resource.kind !== 'file') return
    await window.electronAPI.showInFolder(resource.target)
  }, [resource])

  const showCopiedState = React.useCallback(() => {
    setCopiedText(true)
    window.setTimeout(() => {
      setCopiedText(false)
    }, 2000)
  }, [])

  const handleCopyPlainText = React.useCallback(async () => {
    await navigator.clipboard.writeText(stripMarkdown(textContent ?? ''))
    showCopiedState()
    toast.success(t('toast.copied'))
  }, [showCopiedState, t, textContent])

  const handleCopyMarkdown = React.useCallback(async () => {
    await navigator.clipboard.writeText(textContent ?? '')
    toast.success(t('toast.copied'))
  }, [t, textContent])

  const handleOpenInAppBrowser = React.useCallback(async () => {
    try {
      await openInAppBrowser({
        ...(resource.kind === 'url' ? { url: resource.target } : { filePath: resource.target }),
        bindToSessionId: resourceDetails.sessionId,
      })
    } catch (error) {
      console.error('[SessionResourcePreviewPage] openInAppBrowser failed:', error)
      toast.error(t('toast.failedToCreateBrowser'))
    }
  }, [resource, resourceDetails.sessionId, t])

  const handleAddResourceAnnotation = React.useCallback(async (_messageId: string, annotation: AnnotationV1) => {
    await window.electronAPI.sessionCommand(resourceDetails.sessionId, {
      type: 'addResourceAnnotation',
      resource: resourceRef,
      annotation,
    })
  }, [resourceDetails.sessionId, resourceRef])

  const handleRemoveResourceAnnotation = React.useCallback(async (_messageId: string, annotationId: string) => {
    await window.electronAPI.sessionCommand(resourceDetails.sessionId, {
      type: 'removeResourceAnnotation',
      resource: resourceRef,
      annotationId,
    })
  }, [resourceDetails.sessionId, resourceRef])

  const handleUpdateResourceAnnotation = React.useCallback(async (_messageId: string, annotationId: string, patch: Partial<AnnotationV1>) => {
    await window.electronAPI.sessionCommand(resourceDetails.sessionId, {
      type: 'updateResourceAnnotation',
      resource: resourceRef,
      annotationId,
      patch,
    })
  }, [resourceDetails.sessionId, resourceRef])

  const handleSaveAndSendResourceFollowUp = React.useCallback((followUp: {
    annotationId: string
    note: string
    selectedText: string
  }) => {
    const message = formatResourceFollowUpMessage({
      resource: resourceRef,
      note: followUp.note,
      selectedText: followUp.selectedText,
    })
    onSendMessage(resourceDetails.sessionId, message)

    const sentAt = Date.now()
    const currentAnnotation = resourceAnnotations.find(annotation => annotation.id === followUp.annotationId)
    const currentMeta = currentAnnotation?.meta ?? {}
    const currentFollowUpMeta = currentMeta.followUp && typeof currentMeta.followUp === 'object' && !Array.isArray(currentMeta.followUp)
      ? currentMeta.followUp as Record<string, unknown>
      : {}

    void window.electronAPI.sessionCommand(resourceDetails.sessionId, {
      type: 'updateResourceAnnotation',
      resource: resourceRef,
      annotationId: followUp.annotationId,
      patch: {
        meta: {
          ...currentMeta,
          followUp: {
            ...currentFollowUpMeta,
            text: followUp.note,
            lastSentAt: sentAt,
            lastSentText: followUp.note,
          },
        },
      },
    }).catch((error) => {
      console.error('[SessionResourcePreviewPage] Failed to mark resource follow-up as sent:', error)
    })
  }, [onSendMessage, resourceAnnotations, resourceDetails.sessionId, resourceRef])

  const headerActions = (
    <>
      {supportsLiveBrowser && (
        <PanelHeaderCenterButton
          icon={<Monitor className="h-4 w-4" />}
          onClick={handleOpenInAppBrowser}
          tooltip="Open Live Browser"
        />
      )}
      <PanelHeaderCenterButton
        icon={resource.kind === 'url' ? <Globe className="h-4 w-4" /> : <ExternalLink className="h-4 w-4" />}
        onClick={openExternally}
        tooltip={t('common.open')}
      />
    </>
  )

  const desktopTitleMenu = (
    <>
      <StyledDropdownMenuItem onClick={openExternally}>
        <ExternalLink className="h-3.5 w-3.5" />
        <span className="flex-1">{t('common.open')}</span>
      </StyledDropdownMenuItem>
      {supportsLiveBrowser && (
        <StyledDropdownMenuItem onClick={handleOpenInAppBrowser}>
          <Monitor className="h-3.5 w-3.5" />
          <span className="flex-1">Open Live Browser</span>
        </StyledDropdownMenuItem>
      )}
      {resource.kind === 'file' && (
        <StyledDropdownMenuItem onClick={handleShowInFinder}>
          <FolderOpen className="h-3.5 w-3.5" />
          <span className="flex-1">{t('sessionMenu.showInFileManager', { fileManager: getFileManagerName() })}</span>
        </StyledDropdownMenuItem>
      )}
      <StyledDropdownMenuItem onClick={handleCopyPath}>
        <Copy className="h-3.5 w-3.5" />
        <span className="flex-1">{resource.kind === 'file' ? t('sessionMenu.copyPath') : t('sessionMenu.copyLink')}</span>
      </StyledDropdownMenuItem>
      <StyledDropdownMenuSeparator />
      <StyledDropdownMenuItem onClick={handleOpenInNewWindow}>
        <ExternalLink className="h-3.5 w-3.5" />
        <span className="flex-1">{t('sessionMenu.openInNewWindow')}</span>
      </StyledDropdownMenuItem>
    </>
  )

  const compactTitleMenu = (
    <CompactResourceMenu title={resource.kind === 'file' ? getFileTitle(resource.target) : getUrlTitle(resource.target)}>
      {(close) => (
        <>
          <CompactResourceMenuItem
            icon={<ExternalLink className="h-4 w-4" />}
            label={t('common.open')}
            onClick={async () => { close(); openExternally() }}
          />
          {supportsLiveBrowser && (
            <CompactResourceMenuItem
              icon={<Monitor className="h-4 w-4" />}
              label="Open Live Browser"
              onClick={async () => { close(); await handleOpenInAppBrowser() }}
            />
          )}
          {resource.kind === 'file' && (
            <CompactResourceMenuItem
              icon={<FolderOpen className="h-4 w-4" />}
              label={t('sessionMenu.showInFileManager', { fileManager: getFileManagerName() })}
              onClick={async () => { close(); await handleShowInFinder() }}
            />
          )}
          <CompactResourceMenuItem
            icon={<Copy className="h-4 w-4" />}
            label={resource.kind === 'file' ? t('sessionMenu.copyPath') : t('sessionMenu.copyLink')}
            onClick={async () => { close(); await handleCopyPath() }}
          />
          <div className="mx-4 h-px bg-border/50" />
          <CompactResourceMenuItem
            icon={<ExternalLink className="h-4 w-4" />}
            label={t('sessionMenu.openInNewWindow')}
            onClick={async () => { close(); await handleOpenInNewWindow() }}
          />
        </>
      )}
    </CompactResourceMenu>
  )

  if (resource.kind === 'url') {
    return (
      <div className="h-full flex flex-col min-h-0 bg-background">
        <PanelHeader
          title={getUrlTitle(resource.target)}
          titleMenu={!isCompactMode ? desktopTitleMenu : undefined}
          compactTitleMenu={isCompactMode ? compactTitleMenu : undefined}
          actions={headerActions}
          leadingAction={leadingAction}
          rightSidebarButton={rightSidebarButton}
        />
        <div className="flex-1 min-h-0 bg-white">
          <iframe
            src={resource.target}
            title={getUrlDisplay(resource.target)}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
          />
        </div>
      </div>
    )
  }

  const fileTitle = getFileTitle(resource.target)

  if (!classification?.canPreview || !classification.type) {
    return (
      <div className="h-full flex flex-col min-h-0 bg-background">
        <PanelHeader
          title={fileTitle}
          titleMenu={!isCompactMode ? desktopTitleMenu : undefined}
          compactTitleMenu={isCompactMode ? compactTitleMenu : undefined}
          actions={headerActions}
          leadingAction={leadingAction}
          rightSidebarButton={rightSidebarButton}
        />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
          <AlertCircle className="h-8 w-8" />
          <p className="text-sm">This file type does not support in-panel preview yet.</p>
          <p className="max-w-[720px] text-xs">{resource.target}</p>
        </div>
      </div>
    )
  }

  const renderAnnotatableTextDocument = (content: string, type: string | null, error?: string) => {
    return (
      <div className="h-full min-h-0 bg-foreground-3">
        <div
          className="h-full"
          style={{
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%)',
          }}
        >
          <ScrollArea className="h-full min-w-0">
            <div className="mx-auto min-h-full w-full max-w-[1080px] px-6 py-4">
              <div className="mx-auto w-full max-w-[960px]">
                {error ? (
                  <div className="rounded-[16px] bg-background px-10 py-8 text-sm text-destructive shadow-strong">
                    {error}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-[16px] bg-background shadow-strong">
                    <div className="px-10 py-8">
                      <AnnotatableMarkdownDocument
                        content={formatTextFileForAnnotation(content, resource.target, type)}
                        sessionId={resourceDetails.sessionId}
                        messageId={resourceAnnotationMessageId}
                        annotations={resourceAnnotations}
                        onAddAnnotation={handleAddResourceAnnotation}
                        onRemoveAnnotation={handleRemoveResourceAnnotation}
                        onUpdateAnnotation={handleUpdateResourceAnnotation}
                        onSaveAndSendFollowUp={handleSaveAndSendResourceFollowUp}
                        onOpenFile={handleNestedFileClick}
                        onOpenUrl={handleNestedUrlClick}
                        islandZIndex={420}
                        islandUsePortal
                        hideSentFollowUpAnnotations
                      />
                    </div>
                    <MarkdownActionBar
                      onCopy={() => { void handleCopyPlainText() }}
                      copied={copiedText}
                      secondaryAction={type === 'markdown' ? {
                        icon: <FileText className="h-4 w-4" />,
                        label: <span>{t('common.copy')} Markdown</span>,
                        onClick: () => { void handleCopyMarkdown() },
                      } : undefined}
                    />
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>
    )
  }

  const body = (() => {
    if (classification.type === 'image') {
      return (
        <ImagePreviewOverlay
          isOpen={true}
          onClose={() => {}}
          filePath={resource.target}
          loadDataUrl={(path) => window.electronAPI.readFileDataUrl(path)}
          embedded
          hideHeader
        />
      )
    }

    if (classification.type === 'pdf') {
      return (
        <PDFPreviewOverlay
          isOpen={true}
          onClose={() => {}}
          filePath={resource.target}
          loadPdfData={(path) => window.electronAPI.readFileBinary(path)}
          embedded
          hideHeader
        />
      )
    }

    if (isLoading) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <Spinner className="h-5 w-5 text-muted-foreground" />
        </div>
      )
    }

    if (classification.type === 'code') {
      return renderAnnotatableTextDocument(textContent ?? '', 'code', loadError ?? undefined)
    }

    if (classification.type === 'html') {
      if (loadError) {
        return (
          <div className="flex-1 flex items-center justify-center px-6 text-center text-destructive">
            {loadError}
          </div>
        )
      }

      return (
        <div className="h-full bg-foreground-3 p-4">
          <div className="mx-auto h-full w-full max-w-[1280px] overflow-hidden rounded-[16px] bg-white shadow-strong">
            <iframe
              srcDoc={injectHtmlPreviewBase(textContent ?? '', resource.target)}
              title={fileTitle}
              className="h-full w-full border-0"
              sandbox="allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
            />
          </div>
        </div>
      )
    }

    if (classification.type === 'json') {
      return renderAnnotatableTextDocument(textContent ?? JSON.stringify(jsonData ?? {}, null, 2), 'json', loadError ?? undefined)
    }

    if (classification.type === 'text') {
      return renderAnnotatableTextDocument(textContent ?? '', 'text', loadError ?? undefined)
    }

    return renderAnnotatableTextDocument(textContent ?? '', 'markdown', loadError ?? undefined)
  })()

  return (
    <div className="group h-full flex flex-col min-h-0 bg-background">
      <PanelHeader
        title={fileTitle}
        titleMenu={!isCompactMode ? desktopTitleMenu : undefined}
        compactTitleMenu={isCompactMode ? compactTitleMenu : undefined}
        actions={headerActions}
        leadingAction={leadingAction}
        rightSidebarButton={rightSidebarButton}
      />
      <div className="flex-1 min-h-0 overflow-hidden">
        {body}
      </div>
    </div>
  )
}

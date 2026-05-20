import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  CodePreviewOverlay,
  GenericOverlay,
  ImagePreviewOverlay,
  MarkdownActionBar,
  JSONPreviewOverlay,
  Markdown,
  PDFPreviewOverlay,
  Spinner,
  htmlRequiresBrowserRuntime,
  injectHtmlPreviewBase,
  usePlatform,
} from '@craft-agent/ui'
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
import { useAppShellContext } from '@/context/AppShellContext'
import {
  StyledDropdownMenuItem,
  StyledDropdownMenuSeparator,
} from '@/components/ui/styled-dropdown'
import { toast } from 'sonner'
import { getFileManagerName } from '@/lib/platform'
import type { ArtifactViewMode, SessionArtifactDetails } from '../../shared/types'
import { cn } from '@/lib/utils'
import { stripMarkdown } from '../utils/text'
import { describeArtifact } from '@/lib/artifacts'
import { BrowserArtifactRuntime } from '@/components/artifacts/BrowserArtifactRuntime'
import { useArtifactBrowserRuntime } from '@/hooks/useArtifactBrowserRuntime'

interface ArtifactViewerPageProps {
  artifactDetails: SessionArtifactDetails
  panelId?: string
  isFocusedPanel?: boolean
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

export default function ArtifactViewerPage({
  artifactDetails,
  panelId = 'main',
  isFocusedPanel = true,
}: ArtifactViewerPageProps) {
  const { t } = useTranslation()
  const { rightSidebarButton, leadingAction, onOpenFile, onOpenUrl, isCompactMode } = useAppShellContext()
  const { onOpenFileExternal } = usePlatform()
  const navigationState = useNavigationState()
  const sessionFilter = React.useMemo(
    () => isSessionsNavigation(navigationState)
      ? navigationState.filter
      : { kind: 'allSessions' as const },
    [navigationState],
  )

  const [textContent, setTextContent] = React.useState<string | null>(null)
  const [jsonData, setJsonData] = React.useState<unknown>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [copiedText, setCopiedText] = React.useState(false)
  const descriptor = React.useMemo(() => describeArtifact(artifactDetails.artifact), [artifactDetails.artifact])
  const resource = descriptor.source
  const artifactMode = artifactDetails.mode
  const classification = descriptor.fileClassification
  const classificationType = descriptor.previewType
  const canPreview = descriptor.canPreview
  const supportsLiveBrowser = descriptor.canUseBrowserRuntime
  const htmlNeedsBrowserRuntime = React.useMemo(
    () => classificationType === 'html' && !!textContent && htmlRequiresBrowserRuntime(textContent),
    [classificationType, textContent]
  )
  const isLiveMode = artifactMode === 'live' && supportsLiveBrowser
  const browserRuntime = useArtifactBrowserRuntime({
    active: isLiveMode,
    focused: isFocusedPanel,
    panelId,
    sessionId: artifactDetails.sessionId,
    artifact: resource,
  })

  const buildArtifactRoute = React.useCallback((mode: ArtifactViewMode) => (
    routes.view.artifact({
      sessionId: artifactDetails.sessionId,
      artifactKind: resource.kind,
      target: resource.target,
      filter: sessionFilter,
      mode,
    })
  ), [artifactDetails.sessionId, resource.kind, resource.target, sessionFilter])

  const openResourcePanel = React.useCallback((kind: 'file' | 'url', target: string) => {
    navigate(routes.view.artifact({
      sessionId: artifactDetails.sessionId,
      artifactKind: kind,
      target,
      filter: sessionFilter,
      mode: artifactMode,
    }), { newPanel: true })
  }, [artifactDetails.sessionId, artifactMode, sessionFilter])

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
    if (isLiveMode) {
      setIsLoading(false)
      setLoadError(null)
      return
    }

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
  }, [resource.kind, resource.target, canPreview, classificationType, isLiveMode])

  const openExternally = React.useCallback(() => {
    if (resource.kind === 'file') {
      if (onOpenFileExternal) {
        onOpenFileExternal(resource.target)
      } else {
        onOpenFile(resource.target)
      }
      return
    }

    void window.electronAPI.openUrl(resource.target)
  }, [onOpenFile, onOpenFileExternal, resource])

  const handleOpenInNewWindow = React.useCallback(async () => {
    const route = buildArtifactRoute(artifactMode)
    const separator = route.includes('?') ? '&' : '?'
    const url = `craftagents://${route}${separator}window=focused`
    try {
      await window.electronAPI.openUrl(url)
    } catch (error) {
      console.error('[ArtifactViewerPage] openUrl failed:', error)
    }
  }, [artifactMode, buildArtifactRoute])

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
      await browserRuntime.ensure({ force: true, show: true })
    } catch (error) {
      console.error('[ArtifactViewerPage] openInAppBrowser failed:', error)
      toast.error(t('toast.failedToCreateBrowser'))
    }
  }, [browserRuntime, t])

  const handleReloadLiveBrowser = React.useCallback(async () => {
    try {
      if (browserRuntime.instance) {
        await window.electronAPI.browserPane.reload(browserRuntime.instance.id)
        await browserRuntime.focus()
        return
      }
      await browserRuntime.ensure({ force: true, show: true })
    } catch (error) {
      console.error('[ArtifactViewerPage] reload live browser failed:', error)
      toast.error(t('toast.failedToCreateBrowser'))
    }
  }, [browserRuntime, t])

  const handleSwitchMode = React.useCallback((nextMode: ArtifactViewMode) => {
    navigate(buildArtifactRoute(nextMode))
  }, [buildArtifactRoute])

  const headerActions = (
    <>
      {supportsLiveBrowser && (
        <PanelHeaderCenterButton
          icon={isLiveMode ? <FileText className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
          onClick={() => handleSwitchMode(isLiveMode ? 'preview' : 'live')}
          tooltip={isLiveMode ? 'Switch to Preview' : 'Switch to Live Browser'}
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
        <StyledDropdownMenuItem onClick={() => handleSwitchMode(isLiveMode ? 'preview' : 'live')}>
          {isLiveMode ? <FileText className="h-3.5 w-3.5" /> : <Monitor className="h-3.5 w-3.5" />}
          <span className="flex-1">{isLiveMode ? 'Switch to Preview' : 'Open Live Browser'}</span>
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
    <CompactResourceMenu title={descriptor.title}>
      {(close) => (
        <>
          <CompactResourceMenuItem
            icon={<ExternalLink className="h-4 w-4" />}
            label={t('common.open')}
            onClick={async () => { close(); openExternally() }}
          />
          {supportsLiveBrowser && (
            <CompactResourceMenuItem
              icon={isLiveMode ? <FileText className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
              label={isLiveMode ? 'Switch to Preview' : 'Open Live Browser'}
              onClick={async () => { close(); handleSwitchMode(isLiveMode ? 'preview' : 'live') }}
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

  const liveBrowserBody = (
    <BrowserArtifactRuntime
      title={descriptor.title}
      artifact={resource}
      instance={browserRuntime.instance}
      isEnsuring={browserRuntime.isEnsuring}
      error={browserRuntime.error}
      onShowBrowser={handleOpenInAppBrowser}
      onReload={handleReloadLiveBrowser}
      onBackToPreview={() => handleSwitchMode('preview')}
    />
  )

  if (resource.kind === 'url' && !isLiveMode) {
    return (
      <div className="h-full flex flex-col min-h-0">
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

  const fileTitle = descriptor.title

  if (isLiveMode) {
    return (
      <div className="group h-full flex flex-col min-h-0">
        <PanelHeader
          title={fileTitle}
          titleMenu={!isCompactMode ? desktopTitleMenu : undefined}
          compactTitleMenu={isCompactMode ? compactTitleMenu : undefined}
          actions={headerActions}
          leadingAction={leadingAction}
          rightSidebarButton={rightSidebarButton}
        />
        <div className="flex-1 min-h-0 overflow-hidden">
          {liveBrowserBody}
        </div>
      </div>
    )
  }

  if (!classification?.canPreview || !classification.type) {
    return (
      <div className="h-full flex flex-col min-h-0">
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
      return (
        <CodePreviewOverlay
          isOpen={true}
          onClose={() => {}}
          content={textContent ?? ''}
          filePath={resource.target}
          error={loadError ?? undefined}
          embedded
          hideHeader
        />
      )
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
            {htmlNeedsBrowserRuntime ? (
              <div className="flex h-full items-center justify-center px-8 text-center">
                <div className="max-w-[520px] space-y-3">
                  <div className="text-lg font-medium text-foreground">This HTML requires JavaScript to render.</div>
                  <div className="text-sm text-muted-foreground">
                    The in-panel preview stays sandboxed, so interactive pages should switch to Live Browser mode.
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => handleSwitchMode('live')}
                      className="inline-flex items-center gap-2 rounded-[10px] border border-border/70 bg-background px-4 py-2 text-sm font-medium text-foreground shadow-minimal transition-colors hover:bg-muted"
                    >
                      <Monitor className="h-4 w-4" />
                      <span>Switch to Live Browser</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <iframe
                srcDoc={injectHtmlPreviewBase(textContent ?? '', resource.target)}
                title={fileTitle}
                className="h-full w-full border-0"
                sandbox="allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
              />
            )}
          </div>
        </div>
      )
    }

    if (classification.type === 'json') {
      return (
        <JSONPreviewOverlay
          isOpen={true}
          onClose={() => {}}
          data={jsonData ?? {}}
          filePath={resource.target}
          error={loadError ?? undefined}
          embedded
          hideHeader
        />
      )
    }

    if (classification.type === 'text') {
      return (
        <GenericOverlay
          isOpen={true}
          onClose={() => {}}
          content={textContent ?? ''}
          title={resource.target}
          language="text"
          error={loadError ?? undefined}
          embedded
          hideHeader
        />
      )
    }

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
                {loadError ? (
                  <div className="rounded-[16px] bg-background px-10 py-8 text-sm text-destructive shadow-strong">
                    {loadError}
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-[16px] bg-background shadow-strong">
                    <div className="px-10 py-8">
                      <Markdown
                        mode="minimal"
                        onFileClick={handleNestedFileClick}
                        onUrlClick={handleNestedUrlClick}
                        hideFirstMermaidExpand={false}
                      >
                        {textContent ?? ''}
                      </Markdown>
                    </div>
                    <MarkdownActionBar
                      onCopy={() => { void handleCopyPlainText() }}
                      copied={copiedText}
                      secondaryAction={{
                        icon: <FileText className="h-4 w-4" />,
                        label: <span>{t('common.copy')} Markdown</span>,
                        onClick: () => { void handleCopyMarkdown() },
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        </div>
      </div>
    )
  })()

  return (
    <div className="group h-full flex flex-col min-h-0">
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

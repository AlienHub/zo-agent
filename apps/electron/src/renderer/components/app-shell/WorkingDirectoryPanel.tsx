/**
 * WorkingDirectoryPanel — browse + manage the focused session's working directory.
 *
 * Mirrors SessionFilesSection's tree styling (chevron-on-hover, vertical
 * connector lines, staggered expand animation) but:
 * - points at the working directory via the fs:scanTree / fs:watch RPCs
 * - adds basic management: new file, new folder, rename, delete (to OS trash)
 *
 * Browsing is read-only metadata; management goes through path-validated server
 * handlers (see packages/server-core/src/handlers/rpc/files.ts).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useState, useEffect, useCallback, useRef } from 'react'
import { AnimatePresence, motion, type Variants } from 'motion/react'
import {
  File, Folder, FolderOpen, FileText, Image, FileCode, ChevronRight,
  RefreshCw, Pencil, Trash2, X,
} from 'lucide-react'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
  StyledContextMenuSeparator,
} from '@/components/ui/styled-context-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { useRegisterModal } from '@/context/ModalContext'
import type { SessionFile } from '../../../shared/types'
import { cn } from '@/lib/utils'
import * as storage from '@/lib/local-storage'
import { useAppShellContext } from '@/context/AppShellContext'
import { getFileManagerName } from '@/lib/platform'
import { toast } from 'sonner'

// Stagger animation variants — matches SessionFilesSection / LeftSidebar
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.02, delayChildren: 0.01 },
  },
  exit: {
    opacity: 0,
    transition: { staggerChildren: 0.012, staggerDirection: -1 },
  },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.15, ease: 'easeOut' } },
  exit: { opacity: 0, x: -8, transition: { duration: 0.1, ease: 'easeIn' } },
}

/** Last path segment, cross-platform (handles / and \). */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || p
}

/** 14×14 icon for a tree entry (icons only — no thumbnails, IDE-style). */
function getFileIcon(file: SessionFile, isExpanded?: boolean) {
  const iconClass = 'h-3.5 w-3.5 text-muted-foreground'
  if (file.type === 'directory') {
    return isExpanded ? <FolderOpen className={iconClass} /> : <Folder className={iconClass} />
  }
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext === 'md' || ext === 'markdown') return <FileText className={iconClass} />
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext || '')) {
    return <Image className={iconClass} />
  }
  if (['ts', 'tsx', 'js', 'jsx', 'json', 'yaml', 'yml', 'py', 'rb', 'go', 'rs', 'css', 'html', 'sh'].includes(ext || '')) {
    return <FileCode className={iconClass} />
  }
  return <File className={iconClass} />
}

/** Pending rename/delete operation driving a modal dialog. */
type DialogState =
  | { kind: 'rename'; path: string; currentName: string }
  | { kind: 'delete'; path: string; name: string; isDir: boolean }
  | null

interface WorkingDirTreeItemProps {
  file: SessionFile
  depth: number
  expandedPaths: Set<string>
  onToggleExpand: (path: string) => void
  onFileClick: (file: SessionFile) => void
  onRevealInFileManager: (path: string) => void
  onRequestDialog: (state: DialogState) => void
}

/** Recursive tree row with a CRUD context menu. */
function WorkingDirTreeItem({
  file,
  depth,
  expandedPaths,
  onToggleExpand,
  onFileClick,
  onRevealInFileManager,
  onRequestDialog,
}: WorkingDirTreeItemProps) {
  const { t } = useTranslation()
  const isDirectory = file.type === 'directory'
  const isExpanded = expandedPaths.has(file.path)
  const hasChildren = isDirectory && !!file.children && file.children.length > 0
  const fileManagerName = getFileManagerName()

  const handleClick = () => {
    if (isDirectory) {
      onToggleExpand(file.path)
    } else {
      onFileClick(file)
    }
  }

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isDirectory) onToggleExpand(file.path)
  }

  const buttonElement = (
    <button
      onClick={handleClick}
      className={cn(
        'group flex w-full min-w-0 overflow-hidden items-center gap-2 rounded-[6px] py-[5px] text-[13px] select-none outline-none text-left px-2',
        'focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
        'hover:bg-sidebar-hover transition-colors'
      )}
      title={file.path}
    >
      <span className="relative h-3.5 w-3.5 shrink-0 flex items-center justify-center">
        {isDirectory ? (
          <>
            <span className="absolute inset-0 flex items-center justify-center group-hover:opacity-0 transition-opacity duration-150">
              {getFileIcon(file, isExpanded)}
            </span>
            <span
              className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 cursor-pointer"
              onClick={handleChevronClick}
            >
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200',
                  isExpanded && 'rotate-90'
                )}
              />
            </span>
          </>
        ) : (
          getFileIcon(file)
        )}
      </span>
      <span className="flex-1 min-w-0 truncate">{file.name}</span>
    </button>
  )

  return (
    <div className="group/section min-w-0">
      <ContextMenu>
        <ContextMenuTrigger asChild>{buttonElement}</ContextMenuTrigger>
        <StyledContextMenuContent>
          {file.type !== 'directory' && (
            <StyledContextMenuItem onSelect={() => onFileClick(file)}>
              <FileText className="h-3.5 w-3.5" />
              {t('chat.openFile')}
            </StyledContextMenuItem>
          )}
          <StyledContextMenuItem onSelect={() => onRequestDialog({ kind: 'rename', path: file.path, currentName: file.name })}>
            <Pencil className="h-3.5 w-3.5" />
            {t('workingDir.rename')}
          </StyledContextMenuItem>
          <StyledContextMenuItem onSelect={() => onRevealInFileManager(file.path)}>
            <FolderOpen className="h-3.5 w-3.5" />
            {t('chat.showInFileManager', { fileManager: fileManagerName })}
          </StyledContextMenuItem>
          <StyledContextMenuSeparator />
          <StyledContextMenuItem
            variant="destructive"
            onSelect={() => onRequestDialog({ kind: 'delete', path: file.path, name: file.name, isDir: isDirectory })}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('workingDir.delete')}
          </StyledContextMenuItem>
        </StyledContextMenuContent>
      </ContextMenu>

      {hasChildren && (
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }}
              animate={{ height: 'auto', opacity: 1, marginTop: 2, marginBottom: 8 }}
              exit={{ height: 0, opacity: 0, marginTop: 0, marginBottom: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="flex flex-col select-none min-w-0">
                <motion.nav
                  className="grid gap-0.5 pl-5 pr-0 relative"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <div className="absolute left-[13px] top-1 bottom-1 w-px bg-foreground/10" aria-hidden="true" />
                  {file.children!.map((child) => (
                    <motion.div key={child.path} variants={itemVariants} className="min-w-0">
                      <WorkingDirTreeItem
                        file={child}
                        depth={depth + 1}
                        expandedPaths={expandedPaths}
                        onToggleExpand={onToggleExpand}
                        onFileClick={onFileClick}
                        onRevealInFileManager={onRevealInFileManager}
                        onRequestDialog={onRequestDialog}
                      />
                    </motion.div>
                  ))}
                </motion.nav>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  )
}

/** Confirm dialog for deletes (no shared AlertDialog exists in the app). */
function DeleteConfirmDialog({
  state,
  onCancel,
  onConfirm,
}: {
  state: Extract<DialogState, { kind: 'delete' }>
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  useRegisterModal(true, onCancel)
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('workingDir.deleteConfirmTitle', { name: state.name })}</DialogTitle>
          <DialogDescription>
            {state.isDir ? t('workingDir.deleteConfirmFolder') : t('workingDir.deleteConfirmFile')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>{t('common.cancel')}</Button>
          <Button variant="destructive" onClick={onConfirm}>{t('workingDir.delete')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export interface WorkingDirectoryPanelProps {
  /** Absolute working directory of the focused session (undefined → empty state). */
  workingDirectory?: string
  /**
   * Open a file. ChatPage passes its own opener (which opens the file in a new
   * independent panel via `newPanel: true`); falls back to the global in-app
   * preview from context for standalone use.
   */
  onOpenFile?: (path: string) => void
  /** Close the panel. When provided, a close (✕) button is shown in the header. */
  onClose?: () => void
  className?: string
}

export function WorkingDirectoryPanel({ workingDirectory, onOpenFile: onOpenFileProp, onClose, className }: WorkingDirectoryPanelProps) {
  const { t } = useTranslation()
  const { onOpenFile: ctxOpenFile } = useAppShellContext()
  const onOpenFile = onOpenFileProp ?? ctxOpenFile
  const [tree, setTree] = useState<SessionFile[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [dialogState, setDialogState] = useState<DialogState>(null)
  const [nameInput, setNameInput] = useState('')
  const mountedRef = useRef(true)
  const fileManagerName = getFileManagerName()

  // Restore persisted expanded folders when the working directory changes.
  useEffect(() => {
    if (workingDirectory) {
      const saved = storage.get<string[]>(storage.KEYS.workingDirExpandedFolders, [], workingDirectory)
      setExpandedPaths(new Set(saved))
    } else {
      setExpandedPaths(new Set())
    }
  }, [workingDirectory])

  const saveExpandedPaths = useCallback((paths: Set<string>) => {
    if (workingDirectory) {
      storage.set(storage.KEYS.workingDirExpandedFolders, Array.from(paths), workingDirectory)
    }
  }, [workingDirectory])

  const loadTree = useCallback(async () => {
    if (!workingDirectory) {
      setTree([])
      return
    }
    setIsLoading(true)
    try {
      const entries = await window.electronAPI.scanWorkingDirectory(workingDirectory)
      if (mountedRef.current) setTree(entries)
    } catch (error) {
      console.error('Failed to scan working directory:', error)
      if (mountedRef.current) setTree([])
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }, [workingDirectory])

  // Initial load + file watcher for the working directory.
  useEffect(() => {
    mountedRef.current = true
    void loadTree()

    if (workingDirectory) {
      void window.electronAPI.watchWorkingDirectory(workingDirectory)
      // The watcher is one-per-client and re-established whenever workingDirectory
      // changes, so any event here is for the current root. Reload tolerantly
      // (the server pushes the *resolved* path, which may differ in formatting).
      const unsubscribe = window.electronAPI.onWorkingDirectoryChanged(() => {
        if (mountedRef.current) void loadTree()
      })
      const unsubscribeReconnect = window.electronAPI.onReconnected(() => {
        if (!mountedRef.current) return
        void window.electronAPI.watchWorkingDirectory(workingDirectory)
        void loadTree()
      })
      return () => {
        mountedRef.current = false
        unsubscribe()
        unsubscribeReconnect()
        void window.electronAPI.unwatchWorkingDirectory()
      }
    }
    return () => { mountedRef.current = false }
  }, [workingDirectory, loadTree])

  const handleToggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      saveExpandedPaths(next)
      return next
    })
  }, [saveExpandedPaths])

  const handleFileClick = useCallback((file: SessionFile) => {
    if (file.type === 'directory') {
      handleToggleExpand(file.path)
    } else {
      onOpenFile(file.path)
    }
  }, [onOpenFile, handleToggleExpand])

  const handleReveal = useCallback((path: string) => {
    window.electronAPI.showInFolder(path)
  }, [])

  // --- Manage (rename / delete) -------------------------------------------

  const openDialog = useCallback((state: DialogState) => {
    setNameInput(state?.kind === 'rename' ? state.currentName : '')
    setDialogState(state)
  }, [])

  const closeDialog = useCallback(() => {
    setDialogState(null)
    setNameInput('')
  }, [])

  const submitRename = useCallback(async () => {
    if (dialogState?.kind !== 'rename') return
    const name = nameInput.trim()
    if (!name) return
    try {
      await window.electronAPI.renamePath(dialogState.path, name)
      closeDialog()
      void loadTree()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(t('workingDir.actionFailed', { message }))
    }
  }, [dialogState, nameInput, closeDialog, loadTree, t])

  const confirmDelete = useCallback(async () => {
    if (dialogState?.kind !== 'delete') return
    const { path } = dialogState
    try {
      const result = await window.electronAPI.deletePath(path)
      closeDialog()
      toast.success(result.trashed ? t('workingDir.movedToTrash') : t('workingDir.deleted'))
      void loadTree()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(t('workingDir.actionFailed', { message }))
    }
  }, [dialogState, closeDialog, loadTree, t])

  // --- Render -------------------------------------------------------------

  if (!workingDirectory) {
    return (
      <div className={cn('flex flex-col h-full items-center justify-center text-muted-foreground select-none', className)}>
        <Folder className="h-8 w-8 mb-3 opacity-40" />
        <p className="text-sm">{t('workingDir.noWorkingDirectory')}</p>
      </div>
    )
  }

  const dirName = baseName(workingDirectory)

  return (
    <div className={cn('flex flex-col h-full min-h-0 p-2', className)}>
      {/* The whole directory lives in a card — matches the app's card token
          (rounded-[8px] border shadow-minimal on bg-background). */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-[8px] border border-border/60 bg-background shadow-minimal">
        {/* Card header: working-dir name + actions */}
        <div className="flex items-center justify-between gap-2 h-9 px-3 shrink-0 border-b border-border/50 select-none">
          <span className="text-xs font-medium text-muted-foreground truncate" title={workingDirectory}>{dirName}</span>
          <div className="flex items-center gap-0.5 shrink-0 -mr-1">
            <button
              type="button"
              onClick={() => loadTree()}
              className="p-1 rounded-[5px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
              title={t('workingDir.refresh')}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
            </button>
            <button
              type="button"
              onClick={() => handleReveal(workingDirectory)}
              className="p-1 rounded-[5px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
              title={t('chat.showInFileManager', { fileManager: fileManagerName })}
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-[5px] text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
                title={t('common.close')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-1.5 min-h-0">
          {tree.length === 0 ? (
            <div className="px-4 text-muted-foreground select-none">
              <p className="text-xs">
                {isLoading ? t('workingDir.loading') : t('workingDir.empty')}
              </p>
            </div>
          ) : (
            <nav className="grid gap-0.5 px-2">
              {tree.map((file) => (
                <WorkingDirTreeItem
                  key={file.path}
                  file={file}
                  depth={0}
                  expandedPaths={expandedPaths}
                  onToggleExpand={handleToggleExpand}
                  onFileClick={handleFileClick}
                  onRevealInFileManager={handleReveal}
                  onRequestDialog={openDialog}
                />
              ))}
            </nav>
          )}
        </div>
      </div>

      {/* Rename dialog */}
      {dialogState?.kind === 'rename' && (
        <RenameDialog
          open
          onOpenChange={(open) => { if (!open) closeDialog() }}
          title={t('workingDir.rename')}
          value={nameInput}
          onValueChange={setNameInput}
          onSubmit={() => void submitRename()}
        />
      )}

      {/* Delete confirmation */}
      {dialogState?.kind === 'delete' && (
        <DeleteConfirmDialog
          state={dialogState}
          onCancel={closeDialog}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  )
}

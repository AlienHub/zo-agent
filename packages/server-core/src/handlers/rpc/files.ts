import { readFile, writeFile, unlink, mkdir, readdir, stat, rename, rm } from 'fs/promises'
import { isAbsolute, join, resolve, dirname, parse as parsePath } from 'path'
import { homedir } from 'os'
import { validatePathFormat } from '../../utils/path-validation'
import { randomUUID } from 'crypto'
import { RPC_CHANNELS, type FileAttachment, type DirectoryListingResult, type SessionFile } from '@craft-agent/shared/protocol'
import type { StoredAttachment } from '@craft-agent/core/types'
import { readFileAttachment, validateImageForClaudeAPI, IMAGE_LIMITS } from '@craft-agent/shared/utils'
import { getSessionAttachmentsPath, validateSessionId } from '@craft-agent/shared/sessions'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { resizeImageForAPI, inspectImageBuffer } from '@craft-agent/server-core/services'
import { sanitizeFilename, validateFilePath, getWorkspaceAllowedDirs } from '@craft-agent/server-core/handlers'
import { MarkItDown } from 'markitdown-js'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { requestClientOpenFileDialog, pushTyped } from '@craft-agent/server-core/transport'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.file.READ,
  RPC_CHANNELS.file.READ_DATA_URL,
  RPC_CHANNELS.file.READ_PREVIEW_DATA_URL,
  RPC_CHANNELS.file.READ_BINARY,
  RPC_CHANNELS.file.OPEN_DIALOG,
  RPC_CHANNELS.file.READ_ATTACHMENT,
  RPC_CHANNELS.file.READ_USER_ATTACHMENT,
  RPC_CHANNELS.file.STORE_ATTACHMENT,
  RPC_CHANNELS.file.GENERATE_THUMBNAIL,
  RPC_CHANNELS.fs.SEARCH,
  RPC_CHANNELS.fs.LIST_DIRECTORY,
  RPC_CHANNELS.fs.SCAN_TREE,
  RPC_CHANNELS.fs.WATCH,
  RPC_CHANNELS.fs.UNWATCH,
  RPC_CHANNELS.fs.RENAME,
  RPC_CHANNELS.fs.DELETE,
] as const

/**
 * Directories never recursed into when scanning a working directory tree.
 * Mirrors the SKIP_DIRS set used by fs:search so the file tree never pulls in
 * node_modules / build output / VCS internals.
 */
const WORKING_DIR_SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build',
  '.next', '.nuxt', '.cache', '__pycache__', 'vendor',
  '.idea', '.vscode', 'coverage', '.nyc_output', '.turbo', 'out',
])

// Bounds that keep a single scan cheap even on large repos (with the skip list
// already excluding the usual offenders).
const SCAN_MAX_DEPTH = 8
const SCAN_MAX_ENTRIES = 10_000

interface ClientWorkingDirWatchState {
  watcher: import('fs').FSWatcher
  rootPath: string
  debounceTimer: ReturnType<typeof setTimeout> | null
}

// Per-client working-directory watcher (one active root per client, like the
// session file watcher). Keyed by clientId so concurrent windows are isolated.
const clientWorkingDirWatches = new Map<string, ClientWorkingDirWatchState>()

/**
 * Clean up a client's working-directory watcher. Wired into the same
 * disconnect hooks as cleanupSessionFileWatchForClient to prevent leaks.
 */
export function cleanupWorkingDirWatchForClient(clientId: string): void {
  const state = clientWorkingDirWatches.get(clientId)
  if (!state) return
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer)
    state.debounceTimer = null
  }
  state.watcher.close()
  clientWorkingDirWatches.delete(clientId)
}

/**
 * Recursive working-directory scanner → SessionFile[] tree.
 * Unlike the session scanner: applies WORKING_DIR_SKIP_DIRS, keeps non-ignored
 * dotfiles (.github, .gitignore, .env.example), keeps empty directories, skips
 * symlinks (avoids cycles), and is bounded by depth + a shared entry counter.
 * Sizes are intentionally NOT stat-ed here to keep large scans fast.
 */
export async function scanWorkingDirectory(
  dirPath: string,
  depth: number,
  counter: { n: number },
): Promise<SessionFile[]> {
  if (depth >= SCAN_MAX_DEPTH) return []

  let raw: import('fs').Dirent[]
  try {
    raw = await readdir(dirPath, { withFileTypes: true })
  } catch {
    // Unreadable dir (permissions / race) — treat as empty
    return []
  }

  const dirs: SessionFile[] = []
  const files: SessionFile[] = []

  for (const entry of raw) {
    if (counter.n >= SCAN_MAX_ENTRIES) break
    const name = entry.name
    if (WORKING_DIR_SKIP_DIRS.has(name)) continue
    // Skip symlinks to avoid traversal loops in v1
    if (entry.isSymbolicLink()) continue

    const fullPath = join(dirPath, name)
    if (entry.isDirectory()) {
      counter.n++
      const children = await scanWorkingDirectory(fullPath, depth + 1, counter)
      dirs.push({ name, path: fullPath, type: 'directory', children })
    } else if (entry.isFile()) {
      counter.n++
      files.push({ name, path: fullPath, type: 'file' })
    }
  }

  // Directories first, then files; each alphabetical (case-insensitive)
  dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return [...dirs, ...files]
}

/** Expand a leading ~ to the server's home directory. */
function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

export function registerFilesHandlers(server: RpcServer, deps: HandlerDeps): void {
  // Read a file (with path validation to prevent traversal attacks)
  server.handle(RPC_CHANNELS.file.READ, async (ctx, path: string) => {
    try {
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(path, getWorkspaceAllowedDirs(workspaceId))
      const content = await readFile(safePath, 'utf-8')
      return content
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      // ENOENT is expected for optional config files (e.g. automations.json)
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        deps.platform.logger.debug('readFile: file not found:', path)
      } else {
        deps.platform.logger.error('readFile error:', path, message)
      }
      throw new Error(`Failed to read file: ${message}`)
    }
  })

  // Read an image file as a data URL for in-app image preview overlays.
  // Returns data:{mime};base64,{content} — used by ImagePreviewOverlay and markdown image blocks.
  server.handle(RPC_CHANNELS.file.READ_DATA_URL, async (ctx, path: string) => {
    try {
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(path, getWorkspaceAllowedDirs(workspaceId))
      const buffer = await readFile(safePath)
      const ext = safePath.split('.').pop()?.toLowerCase() ?? ''

      // Map previewable image extensions to MIME types.
      // HEIC/HEIF/TIFF are intentionally excluded — no Chromium codec, opened externally instead.
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        bmp: 'image/bmp',
        ico: 'image/x-icon',
        avif: 'image/avif',
      }
      const mime = mimeMap[ext] || 'application/octet-stream'
      const base64 = buffer.toString('base64')
      return `data:${mime};base64,${base64}`
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('readFileDataUrl error:', message)
      throw new Error(`Failed to read file as data URL: ${message}`)
    }
  })

  // Read an image file as a small preview data URL for lightweight thumbnail rendering.
  // Returns a PNG data URL resized to fit within maxSize×maxSize.
  server.handle(RPC_CHANNELS.file.READ_PREVIEW_DATA_URL, async (ctx, path: string, maxSize = 64) => {
    try {
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(path, getWorkspaceAllowedDirs(workspaceId))
      const size = Number.isFinite(maxSize) ? Math.max(16, Math.min(256, Math.floor(maxSize))) : 64
      const preview = await deps.platform.imageProcessor.process(safePath, {
        resize: { width: size, height: size },
        fit: 'inside',
        format: 'png',
      })
      return `data:image/png;base64,${preview.toString('base64')}`
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('readFilePreviewDataUrl error:', message)
      throw new Error(`Failed to read file preview: ${message}`)
    }
  })

  // Read a file as raw binary (Uint8Array) for react-pdf.
  // The WS transport codec preserves Uint8Array payloads over JSON envelopes.
  server.handle(RPC_CHANNELS.file.READ_BINARY, async (ctx, path: string) => {
    try {
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(path, getWorkspaceAllowedDirs(workspaceId))
      const buffer = await readFile(safePath)
      // Return as Uint8Array (serializes to ArrayBuffer over IPC)
      return new Uint8Array(buffer)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('readFileBinary error:', message)
      throw new Error(`Failed to read file as binary: ${message}`)
    }
  })

  // Open native file dialog for selecting files to attach (routed to client)
  server.handle(RPC_CHANNELS.file.OPEN_DIALOG, async (ctx) => {
    const result = await requestClientOpenFileDialog(server, ctx.clientId, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        // Allow all files by default - the agent can figure out how to handle them
        { name: 'All Files', extensions: ['*'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'] },
        { name: 'Documents', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'txt', 'md', 'rtf'] },
        { name: 'Code', extensions: ['js', 'ts', 'tsx', 'jsx', 'py', 'json', 'css', 'html', 'xml', 'yaml', 'yml', 'sh', 'sql', 'go', 'rs', 'rb', 'php', 'java', 'c', 'cpp', 'h', 'swift', 'kt'] },
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  // Read file and return as FileAttachment with Quick Look thumbnail
  server.handle(RPC_CHANNELS.file.READ_ATTACHMENT, async (ctx, path: string) => {
    try {
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      const safePath = await validateFilePath(path, getWorkspaceAllowedDirs(workspaceId))
      // Use shared utility that handles file type detection, encoding, etc.
      const attachment = await readFileAttachment(safePath)
      if (!attachment) return null

      // Generate thumbnail for image preview
      // Only works for image formats the processor supports — PDFs/Office files get icon fallback
      try {
        const thumbBuffer = await deps.platform.imageProcessor.process(safePath, {
          resize: { width: 200, height: 200 },
          format: 'png',
        })
        ;(attachment as { thumbnailBase64?: string }).thumbnailBase64 = thumbBuffer.toString('base64')
      } catch (thumbError) {
        // Thumbnail generation failed (non-image file or corrupt) — icon fallback
        deps.platform.logger.info('Thumbnail generation failed (using fallback):', thumbError instanceof Error ? thumbError.message : thumbError)
      }

      return attachment
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('readFileAttachment error:', message)
      return null
    }
  })

  // Read a user-attached file (bypasses workspace-dir validation).
  // Used only by renderer draft hydration: the path was written to drafts.json by a
  // previous user-initiated OS-picker / Finder-drag attach, so the path implies consent.
  // NOT exposed to agent code — no equivalent MCP tool. Kept separate from readFileAttachment
  // on purpose to preserve the agent-facing read's narrow trust boundary.
  const USER_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024
  server.handle(RPC_CHANNELS.file.READ_USER_ATTACHMENT, async (_ctx, path: string) => {
    try {
      if (!path || typeof path !== 'string' || !isAbsolute(path)) return null
      const info = await stat(path).catch(() => null)
      if (!info || !info.isFile()) return null
      if (info.size > USER_ATTACHMENT_MAX_BYTES) {
        deps.platform.logger.warn(`[readUserAttachment] file exceeds ${USER_ATTACHMENT_MAX_BYTES} bytes, skipping: ${path}`)
        return null
      }
      const attachment = readFileAttachment(path)
      if (!attachment) return null
      try {
        const thumbBuffer = await deps.platform.imageProcessor.process(path, {
          resize: { width: 200, height: 200 },
          format: 'png',
        })
        ;(attachment as { thumbnailBase64?: string }).thumbnailBase64 = thumbBuffer.toString('base64')
      } catch {
        // Non-image or corrupt — icon fallback, same as readFileAttachment
      }
      return attachment
    } catch (error) {
      deps.platform.logger.error('readUserAttachment error:', error instanceof Error ? error.message : error)
      return null
    }
  })

  // Generate thumbnail from base64 data (for drag-drop files where we don't have a path)
  server.handle(RPC_CHANNELS.file.GENERATE_THUMBNAIL, async (_ctx, base64: string, _mimeType: string): Promise<string | null> => {
    try {
      const buffer = Buffer.from(base64, 'base64')
      const thumbBuffer = await deps.platform.imageProcessor.process(buffer, {
        resize: { width: 200, height: 200 },
        format: 'png',
      })
      return thumbBuffer.toString('base64')
    } catch (error) {
      deps.platform.logger.info('generateThumbnail failed:', error instanceof Error ? error.message : error)
      return null
    }
  })

  // Store an attachment to disk and generate thumbnail/markdown conversion
  // This is the core of the persistent file attachment system
  server.handle(RPC_CHANNELS.file.STORE_ATTACHMENT, async (ctx, sessionId: string, attachment: FileAttachment): Promise<StoredAttachment> => {
    // Track files we've written for cleanup on error
    const filesToCleanup: string[] = []

    try {
      // Reject empty files early
      if (attachment.size === 0) {
        throw new Error('Cannot attach empty file')
      }

      // Get workspace slug from the calling window
      const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
      if (!workspaceId) {
        throw new Error('Cannot determine workspace for attachment storage')
      }
      const workspace = getWorkspaceByNameOrId(workspaceId)
      if (!workspace) {
        throw new Error(`Workspace not found: ${workspaceId}`)
      }
      const workspaceRootPath = workspace.rootPath

      // SECURITY: Validate sessionId to prevent path traversal attacks
      // This must happen before using sessionId in any file path operations
      validateSessionId(sessionId)

      // Create attachments directory if it doesn't exist
      const attachmentsDir = getSessionAttachmentsPath(workspaceRootPath, sessionId)
      await mkdir(attachmentsDir, { recursive: true })

      // Generate unique ID for this attachment
      const id = randomUUID()
      const safeName = sanitizeFilename(attachment.name)
      const storedFileName = `${id}_${safeName}`
      const storedPath = join(attachmentsDir, storedFileName)

      // Track if image was resized (for return value)
      let wasResized = false
      let finalSize = attachment.size
      let resizedBase64: string | undefined

      // 1. Save the file (with image validation and resizing)
      if (attachment.base64) {
        // Images, PDFs, Office files - decode from base64
        let decoded: Buffer = Buffer.from(attachment.base64, 'base64')
        // Validate decoded size matches expected (allow small variance for encoding overhead)
        if (Math.abs(decoded.length - attachment.size) > 100) {
          throw new Error(`Attachment corrupted: size mismatch (expected ${attachment.size}, got ${decoded.length})`)
        }

        // For images: validate and resize if needed for Claude API compatibility
        if (attachment.type === 'image') {
          const imageInspection = await inspectImageBuffer(decoded, deps.platform.imageProcessor)
          const imageSize = imageInspection.status === 'ok'
            ? { width: imageInspection.width, height: imageInspection.height }
            : null

          // Determine if we should resize
          let shouldResize = false
          let targetSize: { width: number; height: number } | undefined

          if (imageInspection.status === 'processor_unavailable') {
            deps.platform.logger.warn('Image processing unavailable while validating attachment:', imageInspection.error?.message ?? 'unknown error')
            if (decoded.length > IMAGE_LIMITS.MAX_SIZE) {
              throw new Error('Image processing is unavailable, so oversized images cannot be validated or resized automatically. Please attach a smaller image.')
            }
          } else if (imageInspection.status === 'invalid_image') {
            throw new Error(imageInspection.error?.message || 'Invalid or unsupported image file')
          } else {
            // Validate image for Claude API
            const validation = validateImageForClaudeAPI(decoded.length, imageSize!.width, imageSize!.height)

            shouldResize = validation.needsResize ?? false
            targetSize = validation.suggestedSize

            if (!validation.valid && validation.errorCode === 'dimension_exceeded') {
              // Image exceeds 8000px limit - calculate resize to fit within limits
              const maxDim = IMAGE_LIMITS.MAX_DIMENSION
              const scale = Math.min(maxDim / imageSize!.width, maxDim / imageSize!.height)
              targetSize = {
                width: Math.floor(imageSize!.width * scale),
                height: Math.floor(imageSize!.height * scale),
              }
              shouldResize = true
              deps.platform.logger.info(`Image exceeds ${maxDim}px limit (${imageSize!.width}x${imageSize!.height}), will resize to ${targetSize.width}x${targetSize.height}`)
            } else if (!validation.valid && validation.errorCode === 'size_exceeded') {
              // File >5MB — try resize+compress instead of rejecting
              shouldResize = true
              deps.platform.logger.info(`Image exceeds 5MB (${(decoded.length / 1024 / 1024).toFixed(1)}MB), will attempt resize`)
            } else if (!validation.valid) {
              throw new Error(validation.error)
            }
          }

          // If resize is needed (either recommended or required), do it now
          if (shouldResize) {
            const isPhoto = attachment.mimeType === 'image/jpeg'

            if (targetSize) {
              // Dimension-exceeded: resize to specific target dimensions
              deps.platform.logger.info(`Resizing image from ${imageSize!.width}x${imageSize!.height} to ${targetSize.width}x${targetSize.height}`)
              try {
                decoded = await deps.platform.imageProcessor.process(decoded, {
                  resize: { width: targetSize.width, height: targetSize.height },
                  format: isPhoto ? 'jpeg' : 'png',
                  quality: isPhoto ? IMAGE_LIMITS.JPEG_QUALITY_HIGH : undefined,
                })
                wasResized = true
                finalSize = decoded.length

                // Re-validate final size after resize
                if (decoded.length > IMAGE_LIMITS.MAX_SIZE) {
                  decoded = await deps.platform.imageProcessor.process(decoded, { format: 'jpeg', quality: IMAGE_LIMITS.JPEG_QUALITY_FALLBACK })
                  finalSize = decoded.length
                  if (decoded.length > IMAGE_LIMITS.MAX_SIZE) {
                    throw new Error(`Image still too large after resize (${(decoded.length / 1024 / 1024).toFixed(1)}MB). Please use a smaller image.`)
                  }
                }
              } catch (resizeError) {
                deps.platform.logger.error('Image resize failed:', resizeError)
                const reason = resizeError instanceof Error ? resizeError.message : String(resizeError)
                throw new Error(`Image too large (${imageSize!.width}x${imageSize!.height}) and automatic resize failed: ${reason}. Please manually resize it before attaching.`)
              }
            } else {
              // Size-exceeded or optimal resize — use shared utility for full pipeline
              const result = await resizeImageForAPI(decoded, { isPhoto })
              if (!result) {
                throw new Error(`Image too large (${(decoded.length / 1024 / 1024).toFixed(1)}MB) and could not be compressed enough. Please use a smaller image.`)
              }
              decoded = result.buffer
              wasResized = true
              finalSize = decoded.length
            }

            deps.platform.logger.info(`Image resized: ${attachment.size} -> ${finalSize} bytes (${Math.round((1 - finalSize / attachment.size) * 100)}% reduction)`)

            // Store resized base64 to return to renderer
            // This is used when sending to Claude API instead of original large base64
            resizedBase64 = decoded.toString('base64')
          }
        }

        await writeFile(storedPath, decoded)
        filesToCleanup.push(storedPath)
      } else if (attachment.text) {
        // Text files - save as UTF-8
        await writeFile(storedPath, attachment.text, 'utf-8')
        filesToCleanup.push(storedPath)
      } else {
        throw new Error('Attachment has no content (neither base64 nor text)')
      }

      // 2. Generate thumbnail (images only — PDFs/Office get icon fallback)
      let thumbnailPath: string | undefined
      let thumbnailBase64: string | undefined
      const thumbFileName = `${id}_thumb.png`
      const thumbPath = join(attachmentsDir, thumbFileName)
      try {
        const pngBuffer = await deps.platform.imageProcessor.process(storedPath, {
          resize: { width: 200, height: 200 },
          format: 'png',
        })
        await writeFile(thumbPath, pngBuffer)
        thumbnailPath = thumbPath
        thumbnailBase64 = pngBuffer.toString('base64')
        filesToCleanup.push(thumbPath)
      } catch (thumbError) {
        // Thumbnail generation failed (non-image or corrupt) — icon fallback
        deps.platform.logger.info('Thumbnail generation failed (using fallback):', thumbError instanceof Error ? thumbError.message : thumbError)
      }

      // 3. Convert Office files to markdown (for sending to Claude)
      // This is required for Office files - Claude can't read raw Office binary
      let markdownPath: string | undefined
      if (attachment.type === 'office') {
        const mdFileName = `${id}_${safeName}.md`
        const mdPath = join(attachmentsDir, mdFileName)
        try {
          const markitdown = new MarkItDown()
          const result = await markitdown.convert(storedPath)
          if (!result || !result.textContent) {
            throw new Error('Conversion returned empty result')
          }
          await writeFile(mdPath, result.textContent, 'utf-8')
          markdownPath = mdPath
          filesToCleanup.push(mdPath)
          deps.platform.logger.info(`Converted Office file to markdown: ${mdPath}`)
        } catch (convertError) {
          // Conversion failed - throw so user knows the file can't be processed
          // Claude can't read raw Office binary, so a failed conversion = unusable file
          const errorMsg = convertError instanceof Error ? convertError.message : String(convertError)
          deps.platform.logger.error('Office to markdown conversion failed:', errorMsg)
          throw new Error(`Failed to convert "${attachment.name}" to readable format: ${errorMsg}`)
        }
      }

      // Return StoredAttachment metadata
      // Include wasResized flag so UI can show notification
      // Include resizedBase64 so renderer uses resized image for Claude API
      return {
        id,
        type: attachment.type,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: finalSize, // Use final size (may differ if resized)
        originalSize: wasResized ? attachment.size : undefined, // Track original if resized
        storedPath,
        thumbnailPath,
        thumbnailBase64,
        markdownPath,
        wasResized,
        resizedBase64, // Only set when wasResized=true, used for Claude API
      }
    } catch (error) {
      // Clean up any files we've written before the error
      if (filesToCleanup.length > 0) {
        deps.platform.logger.info(`Cleaning up ${filesToCleanup.length} orphaned file(s) after storage error`)
        await Promise.all(filesToCleanup.map(f => unlink(f).catch(() => {})))
      }

      const message = error instanceof Error ? error.message : 'Unknown error'
      deps.platform.logger.error('storeAttachment error:', message)
      throw new Error(`Failed to store attachment: ${message}`)
    }
  })

  // Filesystem search for @ mention file selection.
  // Parallel BFS walk that skips ignored directories BEFORE entering them,
  // avoiding reading node_modules/etc. contents entirely. Uses withFileTypes
  // to get entry types without separate stat calls.
  server.handle(RPC_CHANNELS.fs.SEARCH, async (_ctx, basePath: string, query: string) => {
    deps.platform.logger.info('[FS_SEARCH] called:', basePath, query)
    const MAX_RESULTS = 50

    // Directories to never recurse into
    const SKIP_DIRS = new Set([
      'node_modules', '.git', '.svn', '.hg', 'dist', 'build',
      '.next', '.nuxt', '.cache', '__pycache__', 'vendor',
      '.idea', '.vscode', 'coverage', '.nyc_output', '.turbo', 'out',
    ])

    const lowerQuery = query.toLowerCase()
    const results: Array<{ name: string; path: string; type: 'file' | 'directory'; relativePath: string }> = []

    try {
      // BFS queue: each entry is a relative path prefix ('' for root)
      let queue = ['']

      while (queue.length > 0 && results.length < MAX_RESULTS) {
        // Process current level: read all directories in parallel
        const nextQueue: string[] = []

        const dirResults = await Promise.all(
          queue.map(async (relDir) => {
            const absDir = relDir ? join(basePath, relDir) : basePath
            try {
              return { relDir, entries: await readdir(absDir, { withFileTypes: true }) }
            } catch {
              // Skip dirs we can't read (permissions, broken symlinks, etc.)
              return { relDir, entries: [] as import('fs').Dirent[] }
            }
          })
        )

        for (const { relDir, entries } of dirResults) {
          if (results.length >= MAX_RESULTS) break

          for (const entry of entries) {
            if (results.length >= MAX_RESULTS) break

            const name = entry.name
            // Skip hidden files/dirs and ignored directories
            if (name.startsWith('.') || SKIP_DIRS.has(name)) continue

            const relativePath = relDir ? `${relDir}/${name}` : name
            const isDir = entry.isDirectory()

            // Queue subdirectories for next BFS level
            if (isDir) {
              nextQueue.push(relativePath)
            }

            // Check if name or path matches the query
            const lowerName = name.toLowerCase()
            const lowerRelative = relativePath.toLowerCase()
            if (lowerName.includes(lowerQuery) || lowerRelative.includes(lowerQuery)) {
              results.push({
                name,
                path: join(basePath, relativePath),
                type: isDir ? 'directory' : 'file',
                relativePath,
              })
            }
          }
        }

        queue = nextQueue
      }

      // Sort: directories first, then by name length (shorter = better match)
      results.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.length - b.name.length
      })

      deps.platform.logger.info('[FS_SEARCH] returning', results.length, 'results')
      return results
    } catch (err) {
      deps.platform.logger.error('[FS_SEARCH] error:', err)
      return []
    }
  })

  // List directories in a given path (for remote directory browsing).
  // Returns only directories (not files) — this is a folder picker.
  server.handle(RPC_CHANNELS.fs.LIST_DIRECTORY, async (_ctx, dirPath: string) => {
    // Resolve ~ to server's home directory (thin clients don't know the server's home)
    if (dirPath === '~' || dirPath.startsWith('~/')) {
      dirPath = dirPath === '~' ? homedir() : join(homedir(), dirPath.slice(2))
    }

    // Reject cross-platform and relative paths before resolve() can concatenate with cwd
    const pathCheck = validatePathFormat(dirPath)
    if (!pathCheck.valid) {
      throw new Error(pathCheck.reason!)
    }

    // Normalize (collapses .. segments, trailing slashes, etc.)
    const resolved = resolve(dirPath)

    // Read entries, filter to directories
    const raw = await readdir(resolved, { withFileTypes: true })

    const entries: Array<{ name: string; path: string; isSymlink: boolean }> = []
    for (const entry of raw) {
      const fullPath = join(resolved, entry.name)
      const isSymlink = entry.isSymbolicLink()

      if (entry.isDirectory()) {
        entries.push({ name: entry.name, path: fullPath, isSymlink: false })
      } else if (isSymlink) {
        // Follow symlink — check if target is a directory
        try {
          const target = await stat(fullPath)
          if (target.isDirectory()) {
            entries.push({ name: entry.name, path: fullPath, isSymlink: true })
          }
        } catch {
          // Broken symlink — skip silently
        }
      }
    }

    // Sort alphabetically (case-insensitive), cap at 500
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    const totalEntries = entries.length
    const truncated = totalEntries > 500
    if (truncated) entries.length = 500

    // Compute parent path
    const parentPath = resolved === parsePath(resolved).root ? null : dirname(resolved)

    // Compute breadcrumbs server-side
    const breadcrumbs: Array<{ name: string; path: string }> = []
    let current = resolved
    while (true) {
      const parsed = parsePath(current)
      const name = parsed.base || parsed.root
      breadcrumbs.unshift({ name, path: current })
      if (current === parsed.root) break
      current = dirname(current)
    }

    return {
      currentPath: resolved,
      parentPath,
      breadcrumbs,
      platform: process.platform as DirectoryListingResult['platform'],
      truncated,
      totalEntries,
      entries,
    } satisfies DirectoryListingResult
  })

  // ========================================================================
  // Working-directory tree (browse + manage)
  // ========================================================================

  // Recursively scan a working directory into a SessionFile[] tree.
  // Browsing is read-only metadata, so (like LIST_DIRECTORY) this only does a
  // path-format check — it is not restricted to the workspace allowed-dirs.
  server.handle(RPC_CHANNELS.fs.SCAN_TREE, async (_ctx, rootPath: string): Promise<SessionFile[]> => {
    const expanded = expandHome(rootPath)
    const pathCheck = validatePathFormat(expanded)
    if (!pathCheck.valid) throw new Error(pathCheck.reason!)
    const resolved = resolve(expanded)
    try {
      return await scanWorkingDirectory(resolved, 0, { n: 0 })
    } catch (error) {
      deps.platform.logger.error('fs.scanTree error:', error instanceof Error ? error.message : error)
      return []
    }
  })

  // Start watching a working directory for changes (per client, mirrors the
  // session file watcher). Pushes fs:changed with the watched root path.
  server.handle(RPC_CHANNELS.fs.WATCH, async (ctx, rootPath: string) => {
    const clientId = ctx.clientId
    cleanupWorkingDirWatchForClient(clientId)

    const expanded = expandHome(rootPath)
    const pathCheck = validatePathFormat(expanded)
    if (!pathCheck.valid) return
    const resolved = resolve(expanded)

    try {
      const { watch } = await import('fs')
      const state: ClientWorkingDirWatchState = {
        watcher: null as unknown as import('fs').FSWatcher,
        rootPath: resolved,
        debounceTimer: null,
      }

      state.watcher = watch(resolved, { recursive: true }, (_eventType, filename) => {
        // Ignore churn inside ignored top-level dirs (node_modules/.git/...)
        if (filename) {
          const top = String(filename).split(/[\\/]/)[0]
          if (WORKING_DIR_SKIP_DIRS.has(top)) return
        }
        if (state.debounceTimer) clearTimeout(state.debounceTimer)
        state.debounceTimer = setTimeout(() => {
          pushTyped(server, RPC_CHANNELS.fs.CHANGED, { to: 'client', clientId }, state.rootPath)
        }, 150)
      })

      clientWorkingDirWatches.set(clientId, state)
    } catch (error) {
      deps.platform.logger.error('fs.watch error:', error instanceof Error ? error.message : error)
    }
  })

  // Stop watching the working directory for the calling client.
  server.handle(RPC_CHANNELS.fs.UNWATCH, async (ctx) => {
    cleanupWorkingDirWatchForClient(ctx.clientId)
  })

  // Rename a file/folder in place (new name is sanitized → rename only, no move).
  server.handle(RPC_CHANNELS.fs.RENAME, async (ctx, oldPath: string, newName: string): Promise<{ path: string }> => {
    const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
    const allowed = getWorkspaceAllowedDirs(workspaceId)
    const safeOld = await validateFilePath(oldPath, allowed)
    const safeName = sanitizeFilename(newName)
    const target = join(dirname(safeOld), safeName)
    // Validate destination too (rejects renaming to a sensitive name)
    await validateFilePath(target, allowed)
    await rename(safeOld, target)
    return { path: target }
  })

  // Delete a file/folder. Uses the OS trash (recoverable) when the platform
  // provides it (Electron), else falls back to a permanent recursive remove.
  // REMOTE_ELIGIBLE: runs on whichever server owns the workspace.
  server.handle(RPC_CHANNELS.fs.DELETE, async (ctx, targetPath: string): Promise<{ trashed: boolean }> => {
    const workspaceId = ctx.workspaceId ?? deps.windowManager?.getWorkspaceForWindow(ctx.webContentsId!)
    const safePath = await validateFilePath(targetPath, getWorkspaceAllowedDirs(workspaceId))
    if (deps.platform.trashItem) {
      await deps.platform.trashItem(safePath)
      return { trashed: true }
    }
    await rm(safePath, { recursive: true, force: false })
    return { trashed: false }
  })
}

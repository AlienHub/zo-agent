import * as React from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { FolderTree, Upload, X, Paperclip, Database, Box, ArrowUp } from 'lucide-react'
import type { ComponentEntry } from './types'
import { cn } from '@/lib/utils'
import { WorkingDirectoryPanel } from '@/components/app-shell/WorkingDirectoryPanel'
import { PanelHeaderCenterButton } from '@/components/ui/PanelHeaderCenterButton'
import { PlaygroundAppShellProvider } from '../PlaygroundAppShellProvider'

/**
 * Files Panel — Adaptive (inline ↔ popover)
 *
 * Design surface for the embedded working-directory tree when the chat panel is
 * narrow (multi-panel / PANEL_MIN_WIDTH). Renders the REAL `WorkingDirectoryPanel`
 * (backed by the playground's mock electronAPI) so the tree matches the product
 * exactly. The behavior adapts to panel width:
 *  - wide enough (chat stays ≥ minChatWidth)  → inline, side-by-side, persistent.
 *  - narrow (below the breakpoint)            → same button opens a floating
 *    popover over the chat; mouse-out dismisses it.
 */

type Anchor = 'underButton' | 'rightSheet'

const MOCK_WORKING_DIR = '/mock/workspaces/playground-workspace'
const PANEL_HEIGHT = 560

interface FilesAdaptiveDemoProps {
  panelWidth: number
  filesWidth: number
  minChatWidth: number
  anchor: Anchor
  dismissOnLeave: boolean
  leaveDelayMs: number
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-foreground/45">{label}</span>
      <span className={cn('text-sm font-mono', warn ? 'text-destructive' : 'text-foreground/80')}>{value}</span>
    </div>
  )
}

/**
 * Chat body (messages + composer) — header-less, because the real ChatPage puts a
 * single full-width PanelHeader across the top of the whole panel, ABOVE the
 * chat+files split (not a per-column header).
 */
function ChatBody() {
  return (
    <div className="h-full min-w-0 flex flex-col bg-background">
      {/* messages */}
      <div className="flex-1 min-h-0 overflow-hidden px-3 py-2 space-y-3">
        <div className="rounded-[8px] border border-border/50 bg-background shadow-minimal p-3 text-[13px] leading-relaxed text-foreground/80">
          你好！👋 我是 Craft Agent，由 Zo Backend 驱动。
        </div>
        <div className="ml-auto w-fit max-w-[80%] rounded-[8px] bg-foreground/[0.06] px-3 py-2 text-[13px] leading-snug">
          测试一下数据写入一个 md 文件到工作目录内。
        </div>
        <div className="rounded-[8px] border border-border/50 bg-background shadow-minimal p-3 space-y-2">
          <div className="text-[13px] font-medium">✅ 测试完成！文件已成功写入并读取验证</div>
          <div className="h-2 rounded bg-foreground/10 w-[88%]" />
          <div className="h-2 rounded bg-foreground/10 w-[64%]" />
          <div className="rounded-[6px] bg-foreground/[0.04] p-2 font-mono text-[11px] text-foreground/70 leading-relaxed">
            <div className="text-purple-400">def hello():</div>
            <div className="pl-4 text-blue-400">print("Hello, World!")</div>
          </div>
        </div>
      </div>

      {/* composer: matches the real input — textarea + footer pills + send */}
      <div className="shrink-0 px-3 pb-3 pt-1">
        <div className="rounded-[12px] border border-border/60 bg-background shadow-minimal overflow-hidden">
          <div className="px-3 pt-2.5 text-[13px] text-muted-foreground/50">输入消息…</div>
          <div className="h-6" />
          <div className="flex items-center gap-2 px-2.5 pb-2 text-[11px] text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5" />
            <span className="flex items-center gap-1"><Database className="h-3.5 w-3.5" />选择数据源</span>
            <span className="flex items-center gap-1 rounded-md bg-foreground/[0.04] px-1.5 py-0.5"><Box className="h-3.5 w-3.5" />workspace</span>
            <span className="ml-auto">deepseek-v4-pro</span>
            <span className="h-6 w-6 rounded-full bg-foreground/10 flex items-center justify-center">
              <ArrowUp className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function FilesAdaptiveDemo({
  panelWidth,
  filesWidth,
  minChatWidth,
  anchor,
  dismissOnLeave,
  leaveDelayMs,
}: FilesAdaptiveDemoProps) {
  const [open, setOpen] = React.useState(true)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const inlineFits = panelWidth - filesWidth >= minChatWidth
  const mode: 'inline' | 'popover' = inlineFits ? 'inline' : 'popover'
  const threshold = minChatWidth + filesWidth
  const effPopWidth = Math.max(200, Math.min(filesWidth, panelWidth - 16))

  const cancelClose = React.useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }, [])
  const scheduleClose = React.useCallback(() => {
    if (!dismissOnLeave) return
    cancelClose()
    timerRef.current = setTimeout(() => setOpen(false), leaveDelayMs)
  }, [dismissOnLeave, leaveDelayMs, cancelClose])
  React.useEffect(() => () => cancelClose(), [cancelClose])

  const popoverHover = mode === 'popover' ? { onMouseEnter: cancelClose, onMouseLeave: scheduleClose } : {}

  const filesButton = (
    <PanelHeaderCenterButton
      icon={<FolderTree className="h-4 w-4" />}
      tooltip="Files"
      aria-pressed={open}
      onClick={() => setOpen((o) => !o)}
      {...(mode === 'popover' ? { onMouseEnter: cancelClose, onMouseLeave: scheduleClose } : {})}
      className={open ? 'text-accent opacity-100' : undefined}
    />
  )

  return (
    <div className="w-full max-w-[1100px] p-6 space-y-5">
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold">Files Panel — Adaptive (inline ↔ popover)</h2>
        <p className="text-sm text-foreground/70 max-w-[720px]">
          Renders the real <code className="text-xs">WorkingDirectoryPanel</code>. While the chat can stay
          ≥ <code className="text-xs">minChatWidth</code>, the tree opens <strong>inline</strong> (side-by-side, persistent).
          Below the breakpoint, the same <FolderTree className="inline h-3.5 w-3.5 mx-1 -translate-y-px" /> button opens a
          <strong> floating popover</strong> over the chat (chat keeps full width; mouse-out dismisses).
          <strong> Drag <code className="text-xs">panelWidth</code> across {threshold}px</strong> to watch it switch.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-[10px] border border-border bg-background p-3">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-foreground/45">Active mode</span>
          <span className={cn('text-sm font-semibold', mode === 'popover' ? 'text-accent' : 'text-foreground/80')}>
            {mode === 'inline' ? 'Inline (side-by-side)' : 'Popover (floating)'}
          </span>
        </div>
        <Stat label="Panel" value={`${panelWidth}px`} />
        <Stat label="Breakpoint" value={`< ${threshold}px → popover`} warn={!inlineFits} />
        <Stat label="Chat" value={`${mode === 'inline' && open ? panelWidth - filesWidth : panelWidth}px`} />
        <Stat label="State" value={open ? 'open' : 'closed'} />
      </div>

      <div className="rounded-[12px] bg-foreground/[0.03] p-6 overflow-x-auto">
        <div
          className="relative overflow-hidden rounded-[10px] border border-border bg-background shadow-middle mx-auto"
          style={{ width: panelWidth, height: PANEL_HEIGHT }}
        >
          <div className="absolute inset-0 flex flex-col">
            {/* full-width panel header (matches ChatPage: one PanelHeader above the split) */}
            <div className="h-[42px] shrink-0 flex items-center gap-1.5 px-4">
              <div className="flex-1 min-w-0 flex items-center justify-center">
                <span className="text-sm font-semibold truncate">NIH 研究主题</span>
              </div>
              <div className="shrink-0 flex items-center gap-1.5">
                <PanelHeaderCenterButton icon={<Upload className="h-4 w-4" />} tooltip="Share" />
                {filesButton}
                <PanelHeaderCenterButton icon={<X className="h-4 w-4" />} tooltip="Close" />
              </div>
            </div>

            {/* chat + inline files split, BELOW the shared header */}
            <div className="flex-1 min-h-0 flex">
              <div className="flex-1 min-w-0">
                <ChatBody />
              </div>
              {/* inline files — animates width + fade like the product's embedded panel */}
              <AnimatePresence initial={false}>
                {open && mode === 'inline' && (
                  <motion.div
                    key="inline-files"
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: filesWidth, opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                    className="h-full shrink-0 overflow-hidden border-l border-border/40"
                  >
                    <div className="h-full" style={{ width: filesWidth }}>
                      <WorkingDirectoryPanel workingDirectory={MOCK_WORKING_DIR} onClose={() => setOpen(false)} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* floating popover (narrow panels) — real panel, fades + scales from the button */}
          <AnimatePresence>
            {open && mode === 'popover' && (
              <motion.div
                key="popover"
                {...popoverHover}
                initial={{ opacity: 0, scale: 0.96, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -4 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className={cn(
                  'absolute z-20 [filter:drop-shadow(0_12px_32px_rgba(0,0,0,0.30))]',
                  anchor === 'rightSheet' ? 'top-0 bottom-0 right-0' : 'top-[46px] right-2 bottom-2'
                )}
                style={{ width: effPopWidth, transformOrigin: anchor === 'rightSheet' ? 'right center' : 'top right' }}
              >
                {/* !p-0 removes the inline card's outer padding so the card fills the popover edge-to-edge */}
                <WorkingDirectoryPanel workingDirectory={MOCK_WORKING_DIR} onClose={() => setOpen(false)} className="!p-0" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <p className="text-[11px] text-foreground/55 max-w-[720px] leading-snug">
        The open/closed state is shared across modes — resize across the breakpoint while open and it re-renders inline ↔
        popover in place. Auto-dismiss (mouse-out) only applies in popover mode; inline is persistent. The grace delay
        bridges the gap between the button and the popover so it doesn't flicker-close.
      </p>
    </div>
  )
}

export const filesPanelLayoutComponents: ComponentEntry[] = [
  {
    id: 'files-panel-adaptive',
    name: 'Files Panel — Adaptive',
    category: 'Files Panel',
    description: 'Adaptive working-dir panel (real WorkingDirectoryPanel): inline on wide panels, floating popover only in the narrow range.',
    component: FilesAdaptiveDemo,
    wrapper: PlaygroundAppShellProvider,
    layout: 'top',
    props: [
      { name: 'panelWidth', description: 'Content panel width — drag across the breakpoint', control: { type: 'number', min: 320, max: 1000, step: 10 }, defaultValue: 700 },
      { name: 'filesWidth', description: 'Files tree / popover width', control: { type: 'number', min: 200, max: 420, step: 10 }, defaultValue: 260 },
      { name: 'minChatWidth', description: 'Min chat width before switching to popover', control: { type: 'number', min: 240, max: 560, step: 10 }, defaultValue: 360 },
      {
        name: 'anchor',
        description: 'Popover placement (narrow mode)',
        control: { type: 'select', options: [
          { label: 'Floating card (under button)', value: 'underButton' },
          { label: 'Right sheet (full height)', value: 'rightSheet' },
        ] },
        defaultValue: 'underButton',
      },
      { name: 'dismissOnLeave', description: 'Popover auto-dismiss on mouse-out', control: { type: 'boolean' }, defaultValue: true },
      { name: 'leaveDelayMs', description: 'Grace delay before dismiss', control: { type: 'number', min: 0, max: 800, step: 50 }, defaultValue: 200 },
    ],
    variants: [
      { name: 'Wide → inline', props: { panelWidth: 760, filesWidth: 260, minChatWidth: 360, anchor: 'underButton', dismissOnLeave: true, leaveDelayMs: 200 } },
      { name: 'Narrow → popover', props: { panelWidth: 460, filesWidth: 260, minChatWidth: 360, anchor: 'underButton', dismissOnLeave: true, leaveDelayMs: 200 } },
      { name: 'At breakpoint (620)', props: { panelWidth: 620, filesWidth: 260, minChatWidth: 360, anchor: 'underButton', dismissOnLeave: true, leaveDelayMs: 200 } },
      { name: 'Narrow → right sheet', props: { panelWidth: 460, filesWidth: 260, minChatWidth: 360, anchor: 'rightSheet', dismissOnLeave: true, leaveDelayMs: 200 } },
    ],
  },
]

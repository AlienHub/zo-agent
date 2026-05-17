import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'
import { cn } from '../../lib/utils'

export interface MarkdownActionBarSecondaryAction {
  icon: React.ReactNode
  label: React.ReactNode
  onClick: () => void
  active?: boolean
  activeIcon?: React.ReactNode
  activeLabel?: React.ReactNode
}

export interface MarkdownActionBarProps {
  onCopy: () => void
  copied?: boolean
  secondaryAction?: MarkdownActionBarSecondaryAction
  rightSlot?: React.ReactNode
  className?: string
  textClassName?: string
}

export function MarkdownActionBar({
  onCopy,
  copied = false,
  secondaryAction,
  rightSlot,
  className,
  textClassName,
}: MarkdownActionBarProps) {
  const { t } = useTranslation()

  return (
    <div
      className={cn(
        'pl-4 pr-2.5 py-2 border-t border-border/30 flex items-center justify-between bg-muted/20',
        textClassName ?? 'text-sm',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onCopy}
          className={cn(
            'turn-action-btn flex items-center gap-1.5 transition-colors select-none',
            copied ? 'text-success' : 'text-muted-foreground hover:text-foreground',
            'focus:outline-none focus-visible:underline',
          )}
        >
          {copied ? (
            <>
              <Check className="h-4 w-4" />
              <span>{t('common.copied')}</span>
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              <span>{t('common.copy')}</span>
            </>
          )}
        </button>
        {secondaryAction && (
          <button
            type="button"
            onClick={secondaryAction.onClick}
            className={cn(
              'turn-action-btn flex items-center gap-1.5 transition-colors select-none',
              secondaryAction.active ? 'text-success' : 'text-muted-foreground hover:text-foreground',
              'focus:outline-none focus-visible:underline',
            )}
          >
            {secondaryAction.active ? (
              <>
                {secondaryAction.activeIcon ?? secondaryAction.icon}
                <span>{secondaryAction.activeLabel ?? secondaryAction.label}</span>
              </>
            ) : (
              <>
                {secondaryAction.icon}
                <span>{secondaryAction.label}</span>
              </>
            )}
          </button>
        )}
      </div>
      {rightSlot ? <div className="flex items-center gap-3">{rightSlot}</div> : <div />}
    </div>
  )
}

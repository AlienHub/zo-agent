import { useTranslation } from 'react-i18next'
import { ShieldAlert, Check, X, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PermissionRequest as PermissionRequestType } from '../../../../../shared/types'
import type { PermissionResponse } from './types'

interface PermissionRequestProps {
  request: PermissionRequestType
  onResponse: (response: PermissionResponse) => void
  /** When true, removes container styling (shadow, rounded) - used when wrapped by InputContainer */
  unstyled?: boolean
}

function extractSensitiveRule(reason?: string): string | null {
  if (!reason) return null
  const match = reason.match(/Matched sensitive credential file rule:\s*(.+?)(?:\n|$)/)
  return match?.[1]?.trim() || null
}

/**
 * PermissionRequest - Self-contained structured input for permission approval
 *
 * Shows:
 * - Shield icon + "Permission Required" header
 * - Tool name badge
 * - Description of what the tool wants to do
 * - Command preview (scrollable)
 * - Action buttons: Allow, Always Allow, Deny
 */
export function PermissionRequest({ request, onResponse, unstyled = false }: PermissionRequestProps) {
  const { t } = useTranslation()
  const isSensitiveEgress = request.description.startsWith('Sensitive external send:')
  const isSensitiveFileAccess = request.description === 'Sensitive file access'
  const sensitiveRule = isSensitiveFileAccess ? extractSensitiveRule(request.reason) : null
  const description = isSensitiveFileAccess
    ? t('chat.sensitiveFileAccessTitle')
    : request.description

  const handleAllow = () => {
    onResponse({ type: 'permission', allowed: true, alwaysAllow: false, permissionScope: 'once' })
  }

  const handleSend = () => {
    onResponse({ type: 'permission', allowed: true, alwaysAllow: false, egressAction: 'send' })
  }

  const handleSendRedacted = () => {
    onResponse({ type: 'permission', allowed: true, alwaysAllow: false, egressAction: 'send_redacted' })
  }

  const handleAlwaysAllow = () => {
    onResponse({ type: 'permission', allowed: true, alwaysAllow: true })
  }

  const handleAllowForSession = () => {
    onResponse({ type: 'permission', allowed: true, alwaysAllow: true, permissionScope: 'session' })
  }

  const handleAllowPermanently = () => {
    onResponse({ type: 'permission', allowed: true, alwaysAllow: true, permissionScope: 'permanent' })
  }

  const handleDeny = () => {
    onResponse({
      type: 'permission',
      allowed: false,
      alwaysAllow: false,
      ...(isSensitiveEgress ? { egressAction: 'cancel' as const } : {}),
    })
  }

  return (
    <div
      className={cn(
        'overflow-hidden h-full flex flex-col bg-info/5',
        unstyled
          ? 'border-0'
          : 'border border-info/30 rounded-[8px] shadow-middle'
      )}
      data-tutorial="permission-banner"
    >
      {/* Content - grows to fill available space and scrolls before actions disappear */}
      <div className="p-4 space-y-3 flex-1 min-h-0 flex flex-col overflow-y-auto">
        <div className="space-y-2 pb-1">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <ShieldAlert className="h-3.5 w-3.5 text-info" />
            <span>{t('chat.permissionRequired')}</span>
          </div>
          <div className="text-xs leading-[18px] text-muted-foreground">
            <span className="font-medium text-foreground">Tool:</span> {request.toolName}
            <br />
            {description}
          </div>
          {(request.reason || request.impact) && (
            <div className="rounded-md border border-info/20 bg-background/60 p-2 text-xs leading-[18px] text-muted-foreground">
              {isSensitiveFileAccess ? (
                <>
                  <div>
                    {t('chat.sensitiveFileAccessIntro', {
                      path: request.command || t('common.unknown'),
                    })}
                  </div>
                  {sensitiveRule && (
                    <div className="mt-1">
                      {t('chat.sensitiveFileAccessMatchedRule', { rule: sensitiveRule })}
                    </div>
                  )}
                  <div className="mt-1">{t('chat.sensitiveFileAccessImpact')}</div>
                </>
              ) : (
                <>
                  {request.reason && <div>{request.reason}</div>}
                  {request.impact && <div className="mt-1">{request.impact}</div>}
                </>
              )}
            </div>
          )}
        </div>

        {/* Command preview */}
        {request.command && (
          <div className="bg-foreground/5 rounded-md p-3 font-mono text-xs text-foreground/90 whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
            {request.command}
          </div>
        )}
        {isSensitiveEgress && request.safePreview && (
          <div className="space-y-1">
            <div className="text-[11px] font-medium text-muted-foreground">
              {t('chat.permissionSafePreview')}
            </div>
            <div className="bg-foreground/5 rounded-md p-3 font-mono text-xs text-foreground/90 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
              {request.safePreview}
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-t border-border/50">
        {isSensitiveEgress ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 border border-foreground/10 hover:bg-foreground/5 active:bg-foreground/10"
              onClick={handleSend}
            >
              <Check className="h-3.5 w-3.5" />
              {t('chat.permissionSend')}
            </Button>
            <Button
              size="sm"
              variant="default"
              className="h-7 gap-1.5"
              onClick={handleSendRedacted}
              data-tutorial="permission-allow-button"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('chat.permissionSendRedacted')}
            </Button>
          </>
        ) : isSensitiveFileAccess ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 border border-foreground/10 hover:bg-foreground/5 active:bg-foreground/10"
              onClick={handleAllow}
              data-tutorial="permission-allow-button"
            >
              <Check className="h-3.5 w-3.5" />
              {t('chat.permissionAllowOnce')}
            </Button>
            <Button
              size="sm"
              variant="default"
              className="h-7 gap-1.5"
              onClick={handleAllowForSession}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('chat.permissionAllowSession')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 border border-foreground/10 hover:bg-foreground/5 active:bg-foreground/10"
              onClick={handleAllowPermanently}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('chat.permissionAllowPermanent')}
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="default"
              className="h-7 gap-1.5"
              onClick={handleAllow}
              data-tutorial="permission-allow-button"
            >
              <Check className="h-3.5 w-3.5" />
              {t('chat.permissionAllow')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 border border-foreground/10 hover:bg-foreground/5 active:bg-foreground/10"
              onClick={handleAlwaysAllow}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('chat.permissionAlwaysAllow')}
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 text-destructive hover:text-destructive border border-dashed border-destructive/50 hover:bg-destructive/10 hover:border-destructive/70 active:bg-destructive/20"
          onClick={handleDeny}
        >
          <X className="h-3.5 w-3.5" />
          {isSensitiveEgress ? t('chat.permissionCancel') : t('chat.permissionDeny')}
        </Button>

        {/* Tip text */}
        {!isSensitiveEgress && (
          <span className="min-w-0 flex-1 basis-full text-[10px] text-muted-foreground sm:basis-auto sm:text-right">
            {t('chat.permissionRememberHint')}
          </span>
        )}
      </div>
    </div>
  )
}

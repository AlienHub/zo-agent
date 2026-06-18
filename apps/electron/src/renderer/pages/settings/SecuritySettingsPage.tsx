/**
 * SecuritySettingsPage
 *
 * Personal sensitive-protection controls.
 */

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import { useAppShellContext } from '@/context/AppShellContext'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import type { SensitiveContextProtectionSettings } from '../../../shared/types'
import type { SensitivePathAllowRule } from '@craft-agent/shared/agent/guards/sensitive-context'
import {
  SettingsCard,
  SettingsCardContent,
  SettingsSection,
  SettingsToggle,
} from '@/components/settings'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'security',
}

const fallbackSettings: SensitiveContextProtectionSettings = {
  enabled: true,
  sensitiveFiles: { enabled: true, action: 'prompt' },
  outputRedaction: { enabled: true },
  fieldRedaction: { enabled: true },
  egressConfirmation: { enabled: false },
  mode: 'balanced',
  credentialFiles: { enabled: true, action: 'prompt' },
  secrets: { enabled: true, action: 'redact' },
  privateKeys: { enabled: true, action: 'block' },
  pii: { enabled: true, action: 'redact' },
  lowConfidence: { action: 'allow' },
  audit: { enabled: true, storeRawValues: false },
  customPatterns: [],
}

function cloneSettings(settings: SensitiveContextProtectionSettings): SensitiveContextProtectionSettings {
  return {
    ...settings,
    sensitiveFiles: { ...settings.sensitiveFiles },
    outputRedaction: { ...settings.outputRedaction },
    fieldRedaction: { ...settings.fieldRedaction },
    egressConfirmation: { ...settings.egressConfirmation },
    credentialFiles: { ...settings.credentialFiles },
    secrets: { ...settings.secrets },
    privateKeys: { ...settings.privateKeys },
    pii: { ...settings.pii },
    lowConfidence: { ...settings.lowConfidence },
    audit: { ...settings.audit, storeRawValues: false },
    customPatterns: [...settings.customPatterns],
  }
}

export default function SecuritySettingsPage() {
  const { t } = useTranslation()
  const { activeWorkspaceId } = useAppShellContext()
  const [settings, setSettings] = useState<SensitiveContextProtectionSettings>(fallbackSettings)
  const [allowRules, setAllowRules] = useState<SensitivePathAllowRule[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadSettings() {
      try {
        const loaded = await window.electronAPI.getSensitiveContextProtectionSettings()
        if (!cancelled) setSettings(cloneSettings(loaded))
      } catch (error) {
        console.error('Failed to load sensitive context protection settings:', error)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadSettings()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadAllowRules() {
      if (!activeWorkspaceId) {
        setAllowRules([])
        return
      }

      try {
        const loaded = await window.electronAPI.getSensitivePathAllowRules(activeWorkspaceId)
        if (!cancelled) setAllowRules(loaded)
      } catch (error) {
        console.error('Failed to load sensitive path allow rules:', error)
      }
    }

    void loadAllowRules()
    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId])

  const updateSettings = useCallback(async (next: SensitiveContextProtectionSettings) => {
    setSettings(next)
    try {
      await window.electronAPI.setSensitiveContextProtectionSettings(next)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.security.saveFailed'))
    }
  }, [t])

  const patchSettings = useCallback((patch: Partial<SensitiveContextProtectionSettings>) => {
    updateSettings({ ...cloneSettings(settings), ...patch })
  }, [settings, updateSettings])

  const patchToggle = useCallback((
    key: 'sensitiveFiles' | 'outputRedaction' | 'fieldRedaction' | 'egressConfirmation',
    enabled: boolean,
  ) => {
    const next = cloneSettings(settings)

    if (key === 'sensitiveFiles') {
      next.sensitiveFiles = { ...next.sensitiveFiles, enabled }
      next.credentialFiles = { ...next.credentialFiles, enabled, action: next.sensitiveFiles.action }
    } else if (key === 'outputRedaction') {
      next.outputRedaction = { ...next.outputRedaction, enabled }
      next.secrets = { ...next.secrets, enabled }
      next.privateKeys = { ...next.privateKeys, enabled }
      next.pii = { ...next.pii, enabled }
    } else if (key === 'fieldRedaction') {
      next.fieldRedaction = { ...next.fieldRedaction, enabled }
    } else {
      next.egressConfirmation = { ...next.egressConfirmation, enabled }
    }

    updateSettings(next)
  }, [settings, updateSettings])

  const revokeAllowRule = useCallback(async (path: string) => {
    if (!activeWorkspaceId) return

    try {
      const nextRules = await window.electronAPI.removeSensitivePathAllowRule(activeWorkspaceId, path)
      setAllowRules(nextRules)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.security.saveFailed'))
    }
  }, [activeWorkspaceId, t])

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title={t('settings.security.title')} actions={<HeaderMenu route={routes.view.settings('security')} />} />
      <div className="flex-1 min-h-0 mask-fade-y">
        <ScrollArea className="h-full">
          <div className="px-5 py-7 max-w-3xl mx-auto">
            <div className="space-y-8">
              <SettingsSection
                title={t('settings.security.sensitiveContextProtection')}
                description={t('settings.security.sensitiveContextProtectionDesc')}
              >
                <SettingsCard>
                  <SettingsToggle
                    label={t('settings.security.enableProtection')}
                    description={t('settings.security.enableProtectionDesc')}
                    checked={settings.enabled}
                    onCheckedChange={(enabled) => patchSettings({ enabled })}
                    disabled={isLoading}
                  />
                  <SettingsToggle
                    label={t('settings.security.sensitiveFiles')}
                    description={t('settings.security.sensitiveFilesDesc')}
                    checked={settings.sensitiveFiles.enabled}
                    onCheckedChange={(enabled) => patchToggle('sensitiveFiles', enabled)}
                    disabled={isLoading || !settings.enabled}
                  />
                  <SettingsToggle
                    label={t('settings.security.outputRedaction')}
                    description={t('settings.security.outputRedactionDesc')}
                    checked={settings.outputRedaction.enabled}
                    onCheckedChange={(enabled) => patchToggle('outputRedaction', enabled)}
                    disabled={isLoading || !settings.enabled}
                  />
                  <SettingsToggle
                    label={t('settings.security.fieldRedaction')}
                    description={t('settings.security.fieldRedactionDesc')}
                    checked={settings.fieldRedaction.enabled}
                    onCheckedChange={(enabled) => patchToggle('fieldRedaction', enabled)}
                    disabled={isLoading || !settings.enabled}
                  />
                  <SettingsToggle
                    label={(
                      <span className="inline-flex items-center gap-2">
                        <span>{t('settings.security.egressConfirmation')}</span>
                        <span className="rounded-full border border-border/70 bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {t('common.comingSoon')}
                        </span>
                      </span>
                    )}
                    description={t('settings.security.egressConfirmationDesc')}
                    checked={false}
                    onCheckedChange={() => {}}
                    disabled
                  />
                </SettingsCard>
              </SettingsSection>

              <SettingsSection
                title={t('settings.security.allowedPaths')}
                description={t('settings.security.allowedPathsDesc')}
              >
                <SettingsCard>
                  <SettingsCardContent>
                    <AllowedPathRulesList
                      allowRules={allowRules}
                      onRevoke={revokeAllowRule}
                      t={t}
                    />
                  </SettingsCardContent>
                </SettingsCard>
              </SettingsSection>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

export function AllowedPathRulesList({
  allowRules,
  onRevoke,
  t,
}: {
  allowRules: SensitivePathAllowRule[]
  onRevoke: (path: string) => void
  t: (key: string) => string
}) {
  if (allowRules.length === 0) {
    return <div className="text-sm text-muted-foreground">{t('settings.security.noAllowedPaths')}</div>
  }

  return (
    <div className="space-y-2">
      {allowRules.map(rule => (
        <div key={rule.path} className="flex items-center gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-xs text-foreground/90">{rule.path}</div>
            <div className="text-[11px] text-muted-foreground">{new Date(rule.createdAt).toLocaleString()}</div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => onRevoke(rule.path)}
            title={t('common.remove')}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  )
}

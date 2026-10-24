import { useTranslation } from 'react-i18next'
import { navigate, routes } from '@/lib/navigate'
import { Button } from '@/components/ui/button'
import { SettingsRow } from './SettingsRow'

export function RemoteAgentSettingsRow({ model }: { model?: string }) {
  const { t } = useTranslation()
  return (
    <SettingsRow
      label={model || t('settings.agentCompose.remoteSandbox')}
      description={t('settings.agentCompose.remoteExecutionDescription')}
      action={<Button variant="ghost" size="sm" onClick={() => void navigate(routes.view.settings('agent-compose'))}>
        {t('settings.agentCompose.configureRemoteAgent')}
      </Button>}
    />
  )
}

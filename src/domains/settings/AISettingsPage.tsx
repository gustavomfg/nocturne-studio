import { AIConnectionPage } from './AIConnectionPage'
import { useI18n } from '../../shared/i18n'

interface AISettingsPageProps {
  workspaceId: string
  onNotify(message: string): void
  onCodexModelChange(modelId: string): Promise<void>
}

export function AISettingsPage({
  workspaceId,
  onNotify,
  onCodexModelChange,
}: AISettingsPageProps) {
  const { t } = useI18n()
  return <div className="ai-settings" role="region" aria-label={t('ai.configuration')}>
    <AIConnectionPage
      workspaceId={workspaceId}
      onNotify={onNotify}
      onCodexModelChange={onCodexModelChange}
    />
  </div>
}

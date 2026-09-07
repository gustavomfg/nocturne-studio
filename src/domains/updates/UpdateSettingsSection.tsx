import { Check, CheckCircle2, Download, RefreshCw, TriangleAlert } from 'lucide-react'
import type { UpdateState } from '../../../shared/updates'
import { SafeMarkdown } from '../../shared/SafeMarkdown'
import { useI18n } from '../../shared/i18n'

interface UpdateSettingsSectionProps {
  state: UpdateState | null
  connectionError: string | null
  onCheck(): void
  onDownload(): void
  onRetry(): void
  onInstall(): void
}

export function UpdateSettingsSection({ state, connectionError, onCheck, onDownload, onRetry, onInstall }: UpdateSettingsSectionProps) {
  const { t } = useI18n()
  const currentVersion = state?.currentVersion ?? '—'
  const status = state ? statusLabel(state, t) : t('updates.loading')
  const checking = state?.status === 'checking'
  const unsupported = state?.status === 'unsupported'
  const downloadFailure = state?.status === 'error' && (state.stage === 'download' || state.stage === 'validation')

  return <section className="update-settings-card" aria-label={t('updates.title')}>
    <div className="update-settings-product"><div><strong>Nocturne Studio</strong><small>{t('updates.version', { version: currentVersion })}</small></div>{!unsupported && <span className="update-settings-check"><Check size={13}/>{t('updates.automatic')}</span>}</div>
    <div className={`update-settings-status update-status-${state?.status ?? 'idle'}`} role={state?.status === 'error' ? 'alert' : 'status'}>
      {state?.status === 'ready' && <CheckCircle2 size={15}/>} {state?.status === 'error' && <TriangleAlert size={15}/>}<span>{status}</span>
    </div>
    {state?.status === 'available' && <div className="update-settings-details"><SafeMarkdown>{state.releaseNotes || t('updates.noReleaseNotes')}</SafeMarkdown><button className="primary" onClick={onDownload}><Download size={13}/>{t('updates.download')}</button></div>}
    {state?.status === 'downloading' && <div className="update-settings-progress"><div><span>{t('updates.downloading', { version: state.version })}</span><b>{Math.round(state.percent)}%</b></div><progress max="100" value={state.percent} aria-label={t('updates.progressLabel', { percent: Math.round(state.percent) })}/></div>}
    {state?.status === 'ready' && <div className="update-settings-details"><p>{t('updates.readyHint', { version: state.version })}</p><button className="primary" onClick={onInstall}><RefreshCw size={13}/>{t('updates.restart')}</button></div>}
    {state?.status === 'error' && <div className="update-settings-details"><p>{t(`updates.error.${state.stage}`)}</p><button className="primary" onClick={downloadFailure ? onRetry : onCheck}><RefreshCw size={13}/>{downloadFailure ? t('updates.retry') : t('updates.check')}</button></div>}
    {state?.status === 'unsupported' && <p className="update-settings-hint">{state.reason}</p>}
    {connectionError && <p className="update-settings-error" role="alert">{connectionError}</p>}
    {!unsupported && <button className="secondary-setting update-check-button" disabled={checking} onClick={onCheck}>{checking ? t('updates.checking') : t('updates.check')}</button>}
  </section>
}

function statusLabel(state: UpdateState, t: (key: string, values?: Record<string, string | number>) => string) {
  if (state.status === 'idle') return t('updates.readyToCheck')
  if (state.status === 'checking') return t('updates.checking')
  if (state.status === 'up-to-date') return t('updates.upToDate')
  if (state.status === 'available') return t('updates.available', { version: state.version })
  if (state.status === 'downloading') return t('updates.downloading', { version: state.version })
  if (state.status === 'ready') return t('updates.ready')
  if (state.status === 'unsupported') return t('updates.unsupported')
  return t('updates.errorStatus')
}

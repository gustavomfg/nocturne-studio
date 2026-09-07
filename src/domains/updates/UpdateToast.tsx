import { CheckCircle2, Download, Info, RefreshCw, TriangleAlert, X } from 'lucide-react'
import { useState } from 'react'
import type { UpdateState } from '../../../shared/updates'
import { SafeMarkdown } from '../../shared/SafeMarkdown'
import { useI18n } from '../../shared/i18n'

interface UpdateToastProps {
  state: UpdateState | null
  onDownload(): void
  onRetry(): void
  onInstall(): void
}

export function UpdateToast({ state, onDownload, onRetry, onInstall }: UpdateToastProps) {
  const { t } = useI18n()
  const [dismissedAvailableVersion, setDismissedAvailableVersion] = useState<string | null>(null)
  const [dismissedReadyVersion, setDismissedReadyVersion] = useState<string | null>(null)
  const [dismissedErrorVersion, setDismissedErrorVersion] = useState<string | null>(null)
  const [detailsVersion, setDetailsVersion] = useState<string | null>(null)

  if (!state) return null
  if (state.status === 'available') {
    if (state.discoveredBy !== 'automatic' || dismissedAvailableVersion === state.version) return null
    const detailsOpen = detailsVersion === state.version
    return <aside className="product-toast update-toast" role="status" aria-live="polite">
      <div className="update-toast-icon"><Info size={16}/></div>
      <div className="update-toast-content">
        <strong>{t('updates.available', { version: state.version })}</strong>
        {!detailsOpen && <p>{previewNotes(state.releaseNotes) || t('updates.availableHint')}</p>}
        {detailsOpen && <div className="update-release-notes"><SafeMarkdown>{state.releaseNotes || t('updates.noReleaseNotes')}</SafeMarkdown></div>}
        <div className="update-toast-actions">
          {detailsOpen ? <button className="primary" onClick={onDownload}><Download size={13}/>{t('updates.download')}</button> : <button onClick={() => setDetailsVersion(state.version)}>{t('updates.viewDetails')}</button>}
          <button onClick={() => setDismissedAvailableVersion(state.version)}>{t('updates.later')}</button>
        </div>
      </div>
      <button className="update-toast-close" aria-label={t('updates.dismiss')} onClick={() => setDismissedAvailableVersion(state.version)}><X size={14}/></button>
    </aside>
  }

  if (state.status === 'downloading') return <aside className="product-toast update-toast" role="status" aria-live="polite">
    <div className="update-toast-icon"><Download size={16}/></div>
    <div className="update-toast-content">
      <strong>{t('updates.downloading', { version: state.version })}</strong>
      <div className="update-progress-label"><span>{t('updates.progress')}</span><b>{Math.round(state.percent)}%</b></div>
      <progress max="100" value={state.percent} aria-label={t('updates.progressLabel', { percent: Math.round(state.percent) })}/>
    </div>
  </aside>

  if (state.status === 'ready') {
    if (dismissedReadyVersion === state.version) return <button className="update-indicator" aria-label={t('updates.ready')} onClick={() => setDismissedReadyVersion(null)}><CheckCircle2 size={14}/>{t('updates.ready')}</button>
    return <aside className="product-toast update-toast" role="status" aria-live="polite">
      <div className="update-toast-icon"><CheckCircle2 size={16}/></div>
      <div className="update-toast-content">
        <strong>{t('updates.ready')}</strong>
        <p>{t('updates.readyHint', { version: state.version })}</p>
        <div className="update-toast-actions"><button className="primary" onClick={onInstall}><RefreshCw size={13}/>{t('updates.restart')}</button><button onClick={() => setDismissedReadyVersion(state.version)}>{t('updates.later')}</button></div>
      </div>
    </aside>
  }

  if (state.status === 'error' && (state.stage === 'download' || state.stage === 'validation')) {
    if (dismissedErrorVersion === state.version) return null
    return <aside className="product-toast update-toast update-toast-error" role="status" aria-live="polite">
    <div className="update-toast-icon"><TriangleAlert size={16}/></div>
    <div className="update-toast-content">
      <strong>{t('updates.downloadInterrupted')}</strong>
      <p>{errorLabel(state, t)}</p>
      <div className="update-toast-actions"><button className="primary" onClick={onRetry}><RefreshCw size={13}/>{t('updates.retry')}</button><button onClick={() => setDismissedErrorVersion(state.version)}>{t('updates.later')}</button></div>
    </div>
  </aside>
  }

  return null
}

function previewNotes(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 150 ? `${normalized.slice(0, 147)}…` : normalized
}

function errorLabel(state: Extract<UpdateState, { status: 'error' }>, t: (key: string, values?: Record<string, string | number>) => string) {
  return t(`updates.error.${state.stage}`)
}

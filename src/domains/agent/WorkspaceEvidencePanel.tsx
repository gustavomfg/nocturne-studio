import { useEffect, useState } from 'react'
import type { WorkspaceStateManifest } from '../../../shared/workspaceEvidence'
import { useI18n } from '../../shared/i18n'
import { errorMessage } from '../../shared/format'

/** Lazy evidence inspection; unknown never renders as an affirmative success state. */
export function WorkspaceEvidencePanel({ conversationId, executionId }: { conversationId: string | null; executionId: string | null }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const [records, setRecords] = useState<WorkspaceStateManifest[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    let current = true
    if (open && conversationId && executionId) {
      setLoading(true)
      setError(null)
      setRecords([])
      void window.nocturne.evidence.list(conversationId, executionId).then((value) => {
        if (current) setRecords(value)
      }).catch((reason) => { if (current) setError(errorMessage(reason)) }).finally(() => { if (current) setLoading(false) })
    }
    return () => { current = false }
  }, [open, conversationId, executionId, revision])
  if (!conversationId || !executionId) return null
  return <details className="activity-section" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{t('evidence.title')}</summary>
    <div className="document-panel">
      <p>{t('evidence.scope')}</p>
      <button disabled={loading} onClick={() => setRevision((value) => value + 1)}>{t('evidence.refresh')}</button>
      {loading && <p role="status">{t('changeControl.loading')}</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !records.length && <p>{t('evidence.missing')}</p>}
      {records.map((record) => <details key={record.id}>
        <summary>{record.kind} · {t(record.validity === 'stale' ? 'evidence.stale' : 'evidence.unknown')}</summary>
        <p><code>{record.id}</code> · {record.startedAt} → {record.observedAt}</p>
        {record.reason && <p>{record.reason} · {record.staleDetectedAt}</p>}
        {record.truncated && <p>{t('evidence.truncated')}</p>}
        {record.paths.slice(0, 20).map((entry, index) => <p key={`${entry.path}:${index}`}><code>{entry.path}: {entry.hash ?? '?'}</code></p>)}
        {record.references.map((reference, index) => <p key={`${reference.kind}:${reference.id}:${index}`}><code>{reference.kind}: {reference.id}{reference.payloadHash ? ` · ${reference.payloadHash}` : ''}</code></p>)}
      </details>)}
    </div>
  </details>
}

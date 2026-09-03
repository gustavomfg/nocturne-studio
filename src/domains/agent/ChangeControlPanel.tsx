import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, FileCode2, LoaderCircle, ShieldAlert, X } from 'lucide-react'
import type { ChangeRecord, ChangeSetRecord, FileDiff } from '../../../shared/changeControl'
import { errorMessage } from '../../shared/format'
import { useI18n } from '../../shared/i18n'

interface ChangeControlPanelProps {
  conversationId: string | null
  executionId: string | null
  onError(value: string): void
  onNotify(value: string): void
}

/** Presents durable file decisions inside the existing Agent activity inspector. */
export function ChangeControlPanel({ conversationId, executionId, onError, onNotify }: ChangeControlPanelProps) {
  const { t } = useI18n()
  const [changeSet, setChangeSet] = useState<ChangeSetRecord | null>(null)
  const [changes, setChanges] = useState<ChangeRecord[]>([])
  const [diffs, setDiffs] = useState<Record<string, FileDiff | null>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!conversationId || !executionId) {
      setChangeSet(null)
      setChanges([])
      return
    }
    setLoading(true)
    try {
      const nextSet = await window.nocturne.changeControl.get(conversationId, executionId)
      setChangeSet(nextSet)
      setChanges(nextSet ? await window.nocturne.changeControl.changes(conversationId, nextSet.id) : [])
      setDiffs({})
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [conversationId, executionId, onError])

  useEffect(() => {
    let active = true
    void reload().then(() => { if (!active) return }).catch(() => undefined)
    if (!conversationId || !executionId) return () => { active = false }
    const offChanged = window.nocturne.changeControl.onChanged((event) => {
      if (event.executionId === executionId) void reload()
    })
    return () => { active = false; offChanged() }
  }, [conversationId, executionId, reload])

  if (!changeSet || !changes.length) return null

  const decide = async (change: ChangeRecord, status: 'accepted' | 'rejected') => {
    if (!conversationId) return
    try {
      const result = await window.nocturne.changeControl.decide(conversationId, change.id, status)
      setChangeSet(result.changeSet)
      setChanges((current) => current.map((item) => item.id === result.change.id ? result.change : item))
      onNotify(status === 'accepted' ? t('changeControl.accepted') : t('changeControl.rejected'))
    } catch (error) {
      onError(errorMessage(error))
    }
  }

  const toggleDiff = async (change: ChangeRecord) => {
    if (!conversationId) return
    if (expanded === change.id) {
      setExpanded(null)
      return
    }
    setExpanded(change.id)
    if (Object.prototype.hasOwnProperty.call(diffs, change.id)) return
    try {
      const diff = await window.nocturne.changeControl.diff(conversationId, change.id)
      setDiffs((current) => ({ ...current, [change.id]: diff }))
    } catch (error) {
      setExpanded(null)
      onError(errorMessage(error))
    }
  }

  return <section className="activity-section change-control-section" aria-labelledby="change-control-title"><div className="change-control-heading"><ShieldAlert size={14}/><span id="change-control-title">{t('changeControl.title')}</span><span>{changes.length}</span></div><div className="change-control-panel"><p className="change-control-summary">{statusLabel(changeSet.status, t)} · {t('changeControl.execution')} <code>{changeSet.executionId.slice(0, 8)}</code></p>{loading && <p className="change-control-loading" role="status"><LoaderCircle size={14}/>{t('changeControl.loading')}</p>}<div className="change-control-list">{changes.map((change) => <article className={`change-control-item ${change.status}`} key={change.id}><header><FileCode2 size={14}/><strong title={change.relativePath}>{change.relativePath}</strong><span className={`change-control-status ${change.status}`}>{statusLabel(change.status, t)}</span></header><p>{operationLabel(change.operation, t)} · {t('changeControl.hash')} <code>{shortHash(change.afterHash ?? change.beforeHash)}</code></p>{change.policy !== 'allowed' && <p className={`change-control-policy ${change.policy}`}><ShieldAlert size={13}/>{change.policyReason ?? t('changeControl.policyReview')}</p>}<footer><button type="button" onClick={() => void toggleDiff(change)}>{expanded === change.id ? <ChevronDown size={13}/> : <ChevronDown className="closed" size={13}/>} {t('changeControl.viewDiff')}</button>{change.status === 'pending' && change.policy !== 'blocked' && <><button type="button" onClick={() => void decide(change, 'rejected')}><X size={13}/>{t('changeControl.reject')}</button><button type="button" className="primary" onClick={() => void decide(change, 'accepted')}><Check size={13}/>{t('changeControl.accept')}</button></>}</footer>{expanded === change.id && <DiffPreview diff={diffs[change.id]} t={t}/>}</article>)}</div></div></section>
}

function DiffPreview({ diff, t }: { diff: FileDiff | null | undefined; t: (key: string) => string }) {
  if (!diff) return <p className="change-control-loading">{t('changeControl.diffUnavailable')}</p>
  if (diff.kind === 'binary') return <p className="change-control-notice">{t('changeControl.binaryDiff')}</p>
  if (diff.kind === 'large') return <p className="change-control-notice">{t('changeControl.largeDiff')}</p>
  if (diff.kind === 'missing' || diff.kind === 'unsupported') return <p className="change-control-notice">{t('changeControl.unsupportedDiff')}</p>
  return <pre className="change-control-diff">{diff.unifiedDiff}</pre>
}

function shortHash(hash: string | null) {
  return hash ? hash.slice(0, 12) : '—'
}

function statusLabel(status: string, t: (key: string) => string) {
  return ({ pending: t('changeControl.pending'), accepted: t('changeControl.accepted'), rejected: t('changeControl.rejected'), edited: t('changeControl.edited'), conflicted: t('changeControl.conflicted'), 'partially-accepted': t('changeControl.partiallyAccepted') } as Record<string, string>)[status] ?? status
}

function operationLabel(operation: ChangeRecord['operation'], t: (key: string) => string) {
  return ({ create: t('changeControl.created'), modify: t('changeControl.modified'), delete: t('changeControl.deleted'), rename: t('changeControl.renamed') }[operation])
}

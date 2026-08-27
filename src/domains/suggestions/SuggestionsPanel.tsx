import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, ArrowRight, Check, Clipboard, Eye, FileCode2, GitCommit, ShieldAlert, X } from 'lucide-react'
import { suggestedCommit } from '../../../shared/suggestions'
import type { Suggestion, SuggestionStatus } from '../../types'
import { useDialogA11y } from '../../shared/useDialogA11y'
import { errorMessage } from '../../shared/format'
import { projectHealth, type ProjectHealth } from './projectHealth'
import { useI18n } from '../../shared/i18n'
import './suggestions.css'

interface Props { suggestions: Suggestion[]; hasMore: boolean; loadingMore: boolean; onLoadMore(): void; onStatus(suggestion: Suggestion, status: SuggestionStatus): void; onApply(suggestion: Suggestion): void; onOpenFile(filePath: string): void; onNotify(value: string): void }
type HealthLabel = keyof ProjectHealth
type HealthChange = { from: number; to: number }

export function SuggestionsPanel({ suggestions, hasMore, loadingMore, onLoadMore, onStatus, onApply, onOpenFile, onNotify }: Props) {
  const { t, language } = useI18n()
  const [selected, setSelected] = useState<Suggestion | null>(null)
  const health = useMemo(() => projectHealth(suggestions, language), [suggestions, language])
  const previousHealth = useRef<ProjectHealth | null>(null)
  const healthTimer = useRef<number | null>(null)
  const [healthChanges, setHealthChanges] = useState<Partial<Record<HealthLabel, HealthChange>>>({})
  const [healthAnnouncement, setHealthAnnouncement] = useState('')

  useEffect(() => {
    const previous = previousHealth.current
    previousHealth.current = health
    if (!previous) return
    const changes: Partial<Record<HealthLabel, HealthChange>> = {}
    for (const label of Object.keys(health) as HealthLabel[]) {
      if (previous[label].score !== health[label].score) changes[label] = { from: previous[label].score, to: health[label].score }
    }
    const changed = Object.entries(changes) as Array<[HealthLabel, HealthChange]>
    if (!changed.length) return
    setHealthChanges(changes)
    setHealthAnnouncement(`${t('suggestions.healthUpdated')} ${changed.map(([label, value]) => `${healthLabel(label, t)} ${t('suggestions.changedFromTo', { from: value.from, to: value.to })}`).join('. ')}.`)
    if (healthTimer.current !== null) window.clearTimeout(healthTimer.current)
    healthTimer.current = window.setTimeout(() => { setHealthChanges({}); setHealthAnnouncement(''); healthTimer.current = null }, 3_200)
  }, [health, t])
  useEffect(() => () => { if (healthTimer.current !== null) window.clearTimeout(healthTimer.current) }, [])

  if (!suggestions.length) return <div className="inspector-empty"><div><ShieldAlert size={22}/></div><p>{t('suggestions.emptyPublished')}</p><small>{t('suggestions.reviewHint')}</small></div>
  return <div className="suggestions-view">
    <section className={`health-card ${Object.keys(healthChanges).length ? 'is-updated' : ''}`}><div><strong>{t('suggestions.projectHealth')}</strong><small>{Object.keys(healthChanges).length ? t('suggestions.recalculated') : t('suggestions.openEstimate')}</small></div><p className="sr-only" role="status" aria-live="polite">{healthAnnouncement}</p><div className="health-grid">{Object.entries(health).map(([rawLabel, metric]) => { const label = rawLabel as HealthLabel; const change = healthChanges[label]; return <span className={`health-metric ${change ? change.to > change.from ? 'improved' : 'declined' : ''}`} key={label} title={metric.explanation}><b>{healthLabel(label, t)}</b><div className="health-score">{change && <><s>{change.from}/10</s><ArrowRight size={12}/></>}<strong>{metric.score}/10</strong></div><small>{metric.explanation}</small></span> })}</div></section>
    <div className="suggestion-list">{suggestions.map((suggestion) => <article className={`suggestion-card ${suggestion.severity}`} key={suggestion.id}><header><span/><b>{categoryLabel(suggestion.category, t)}</b><small>{severityLabel(suggestion.severity, t)} · {t('suggestions.confidence', { count: suggestion.confidence })}</small></header><h4>{suggestion.title}</h4><p>{suggestion.description}</p><div className="suggestion-files">{suggestion.affectedFiles.slice(0, 4).map((file) => <button key={file} onClick={() => onOpenFile(file)}><FileCode2 size={12}/>{file}</button>)}</div><footer><em className={suggestion.status}>{statusLabel(suggestion.status, t)} · {new Date(suggestion.updatedAt).toLocaleDateString(language === 'en' ? 'en-US' : 'pt-BR')}</em><button onClick={() => setSelected(suggestion)}><Eye size={13}/>{t('suggestions.viewSolution')}</button>{suggestion.status === 'new' && <button onClick={() => onStatus(suggestion, 'in-analysis')}>{t('suggestions.analyze')}</button>}{!['accepted', 'resolved', 'rejected', 'invalid'].includes(suggestion.status) && <><button onClick={() => onStatus(suggestion, 'rejected')}><X size={13}/>{t('suggestions.reject')}</button><button className="apply" onClick={() => onApply(suggestion)}><Check size={13}/>{t('suggestions.apply')}</button></>}</footer></article>)}{hasMore && <button className="collection-load-more" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? t('common.loading') : t('suggestions.loadOlder')}</button>}</div>
    {selected && <SuggestionDialog suggestion={selected} onClose={() => setSelected(null)} onStatus={(status) => { onStatus(selected, status); setSelected(null) }} onApply={() => { setSelected(null); onApply(selected) }} onOpenFile={onOpenFile} onNotify={onNotify}/>}
  </div>
}

function SuggestionDialog({ suggestion, onClose, onStatus, onApply, onOpenFile, onNotify }: { suggestion: Suggestion; onClose(): void; onStatus(status: SuggestionStatus): void; onApply(): void; onOpenFile(file: string): void; onNotify(value: string): void }) {
  const { t, language } = useI18n()
  const commit = suggestedCommit(suggestion)
  const [copied, setCopied] = useState<'diff' | 'commit' | null>(null)
  const [copying, setCopying] = useState<'diff' | 'commit' | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const dialogRef = useDialogA11y<HTMLElement>(onClose)
  const copy = async (kind: 'diff' | 'commit', content: string) => {
    if (copying) return
    setCopying(kind)
    try { setCopyError(null); await window.nocturne.clipboard.writeText(content); setCopied(kind); onNotify(kind === 'diff' ? t('suggestions.solutionCopied') : t('suggestions.commitCopied')); window.setTimeout(() => setCopied((current) => current === kind ? null : current), 1_600) }
    catch (error) { setCopyError(errorMessage(error)) }
    finally { setCopying(null) }
  }
  return createPortal(<div className="preview-backdrop" onMouseDown={onClose}><section ref={dialogRef} className="suggestion-dialog" role="dialog" aria-modal="true" aria-labelledby="suggestion-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
    <header><div><AlertTriangle size={17}/><span><strong id="suggestion-title">{suggestion.title}</strong><small>{categoryLabel(suggestion.category, t)} · {t('suggestions.level')} {severityLabel(suggestion.severity, t)} · {t('suggestions.complexity')} {severityLabel(suggestion.complexity, t)} · {t('suggestions.risk')} {severityLabel(suggestion.risk, t)}</small></span></div><button aria-label={t('common.close')} title={t('common.close')} onClick={onClose}><X size={17}/></button></header>
    <div className="suggestion-dialog-body"><h3>{t('suggestions.problemImpact')}</h3><p>{suggestion.description}</p><h3>{t('suggestions.reasoning')}</h3><p>{suggestion.reasoning}</p><h3>{t('suggestions.evidence')}</h3>{suggestion.evidence.length ? <ul>{suggestion.evidence.map((evidence, index) => <li key={`${evidence.source}-${evidence.location ?? index}`}><strong>{evidence.source}</strong>{evidence.location ? ` · ${evidence.location}` : ''}: {evidence.detail}</li>)}</ul> : <p>{t('suggestions.noEvidence')}</p>}<h3>{t('suggestions.provenance')}</h3><p>{t('suggestions.source')}: {suggestion.source} · {t('suggestions.responsible')}: {suggestion.responsible} · {t('suggestions.confidence', { count: suggestion.confidence })} · {t('agent.updatedAt')} {new Date(suggestion.updatedAt).toLocaleString(language === 'en' ? 'en-US' : 'pt-BR')}</p><h3>{t('suggestions.history')}</h3><ul>{suggestion.history.map((entry) => <li key={entry.id}>{statusLabel(entry.status, t)} · {new Date(entry.createdAt).toLocaleString(language === 'en' ? 'en-US' : 'pt-BR')}{entry.result ? ` — ${entry.result}` : ''}</li>)}</ul><h3>{t('suggestions.benefits')}</h3>{suggestion.expectedBenefits.length ? <ul>{suggestion.expectedBenefits.map((benefit) => <li key={benefit}>{benefit}</li>)}</ul> : <p>{t('suggestions.notInformed')}</p>}<h3>{t('suggestions.affectedFiles')}</h3><div className="dialog-files">{suggestion.affectedFiles.map((file) => <button key={file} onClick={() => onOpenFile(file)}><FileCode2 size={12}/>{file}</button>)}</div><div className="proposal-title"><h3>{t('suggestions.proposedSolution')}</h3><button disabled={Boolean(copying)} onClick={() => void copy('diff', suggestion.proposedChanges)}><Clipboard size={12}/>{copying === 'diff' ? t('suggestions.copying') : copied === 'diff' ? t('suggestions.copied') : t('suggestions.copyDiff')}</button></div><pre className="proposal-diff">{suggestion.proposedChanges.split('\n').map((line, index) => <span className={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : ''} key={index}>{line}{'\n'}</span>)}</pre><div className="commit-suggestion"><GitCommit size={14}/><span><small>{t('suggestions.suggestedCommit')}</small><code>{commit}</code></span><button disabled={Boolean(copying)} aria-label={copying === 'commit' ? t('suggestions.copyingCommit') : copied === 'commit' ? t('suggestions.commitCopied') : t('suggestions.copyCommit')} title={t('suggestions.copyCommit')} onClick={() => void copy('commit', commit)}>{copied === 'commit' ? <Check size={12}/> : <Clipboard size={12}/>}</button></div></div>
    {copyError && <p className="suggestion-copy-error" role="alert">{copyError}</p>}<footer><button onClick={onClose}>{t('common.close')}</button>{!['rejected', 'resolved', 'invalid'].includes(suggestion.status) && <><button onClick={() => onStatus('deferred')}>{t('suggestions.defer')}</button><button onClick={() => onStatus('invalid')}>{t('suggestions.markInvalid')}</button><button className="primary" onClick={onApply}>{t('common.prepareApplication')}</button></>}</footer>
  </section></div>, document.body)
}

function healthLabel(value: HealthLabel, t: (key: string) => string) {
  const key = ({ Arquitetura: 'suggestions.architecture', Segurança: 'suggestions.security', Testes: 'suggestions.testing', Performance: 'suggestions.performance', Manutenção: 'suggestions.maintenance', Documentação: 'suggestions.documentation' } as Record<string, string>)[value]
  return key ? t(key) : value
}
function categoryLabel(value: string, t: (key: string) => string) { return ({ architecture: t('suggestions.architecture'), security: t('suggestions.security'), performance: t('suggestions.performance'), bug: t('suggestions.bug'), cleanup: t('suggestions.cleanup'), testing: t('suggestions.testing'), documentation: t('suggestions.documentation'), dependency: t('suggestions.dependency'), accessibility: t('suggestions.accessibility') } as Record<string, string>)[value] ?? value }
function statusLabel(status: SuggestionStatus, t: (key: string) => string) { return ({ new: t('suggestions.statusNew'), 'in-analysis': t('suggestions.statusAnalysis'), accepted: t('suggestions.statusAccepted'), rejected: t('suggestions.statusRejected'), resolved: t('suggestions.statusResolved'), deferred: t('suggestions.statusDeferred'), invalid: t('suggestions.statusInvalid') } as Record<string, string>)[status] ?? status }
function severityLabel(value: string, t: (key: string) => string) { return ({ info: t('suggestions.severityInfo'), low: t('suggestions.severityLow'), medium: t('suggestions.severityMedium'), high: t('suggestions.severityHigh'), critical: t('suggestions.severityCritical') } as Record<string, string>)[value] || value }

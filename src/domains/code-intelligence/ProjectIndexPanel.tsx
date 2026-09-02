import { useMemo } from 'react'
import { Check, FileCode2, LoaderCircle, Play, RefreshCw, Search, Square, TriangleAlert } from 'lucide-react'
import type { ProjectIndexStatus, ProjectIndexSummary, ProjectSymbol, StackEvidence, ValidationKind, ValidationRun } from '../../../shared/codeIntelligence'
import { useI18n } from '../../shared/i18n'

export interface ProjectIndexPanelProps {
  workspace: string
  status: ProjectIndexStatus | null
  summary: ProjectIndexSummary | null
  stack: StackEvidence[]
  symbols: ProjectSymbol[]
  query: string
  loading: boolean
  onQuery(value: string): void
  onSearch(): void
  onStart(): void
  onCancel(): void
  onRetry(): void
  validationRuns: ValidationRun[]
  validationLoading: boolean
  onValidation(kind: ValidationKind): void
  onValidationCancel(): void
  showTitle?: boolean
}

export function ProjectIndexPanel({ workspace, status, summary, stack, symbols, query, loading, onQuery, onSearch, onStart, onCancel, onRetry, validationRuns, validationLoading, onValidation, onValidationCancel, showTitle = true }: ProjectIndexPanelProps) {
  const { t } = useI18n()
  const stackValues = useMemo(() => [...new Set(stack.filter((item) => item.category !== 'script' && item.category !== 'convention').map((item) => item.value))], [stack])
  const busy = status?.status === 'queued' || status?.status === 'running'
  const validationBusy = validationLoading || validationRuns[0]?.status === 'queued' || validationRuns[0]?.status === 'running'
  const progress = status && status.totalFiles > 0 ? Math.min(1, status.processedFiles / status.totalFiles) : 0
  if (!workspace) return <div className="inspector-empty"><div><FileCode2 size={22}/></div><p>{t('projectIndex.noWorkspace')}</p></div>
  return <div className="project-index-panel">
    <section className="project-index-status" aria-label={showTitle ? undefined : t('projectIndex.title')} aria-live="polite">
      {showTitle && <header><div><FileCode2 size={15}/><strong>{t('projectIndex.title')}</strong></div><StatusIcon status={status}/></header>}
      {!status && <p>{t('projectIndex.waiting')}</p>}
      {status && <><div className="project-index-status-line"><span>{statusLabel(status.status, t)}</span><small>{status.processedFiles}/{status.totalFiles || '—'}</small></div><div className="project-index-progress"><span style={{ transform: `scaleX(${progress})` }}/></div>{status.currentPath && <small className="project-index-current">{status.currentPath}</small>}{status.error && <p className="project-index-error"><TriangleAlert size={13}/>{status.error}</p>}</>}
      <div className="project-index-actions">{busy ? <button type="button" onClick={onCancel}><Square size={13}/>{t('projectIndex.cancel')}</button> : <button type="button" onClick={onStart}><RefreshCw size={13}/>{t('projectIndex.reindex')}</button>}{status?.failedFiles ? <button type="button" onClick={onRetry}><RefreshCw size={13}/>{t('projectIndex.retry')}</button> : null}</div>
    </section>
    {summary && <section className="project-index-section"><h3>{t('projectIndex.summary')}</h3><div className="project-index-metrics"><span><strong>{summary.files}</strong>{t('projectIndex.files')}</span><span><strong>{summary.symbols}</strong>{t('projectIndex.symbols')}</span><span><strong>{summary.imports + summary.exports}</strong>{t('projectIndex.relations')}</span></div></section>}
    <section className="project-index-section"><h3>{t('projectIndex.stack')}</h3>{stackValues.length ? <div className="project-index-tags">{stackValues.map((value) => <span key={value}>{value}</span>)}</div> : <p className="project-index-muted">{t('projectIndex.noStack')}</p>}{stack.length > 0 && <div className="project-index-evidence">{stack.slice(0, 6).map((item) => <div key={item.id}><small>{item.value} ← {item.sourcePath} · {item.sourceHash.slice(0, 8)}</small><span>{item.reason}</span></div>)}</div>}</section>
    <section className="project-index-section"><h3>{t('projectIndex.symbolSearch')}</h3><div className="project-index-search"><input value={query} onChange={(event) => onQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSearch() }} placeholder={t('projectIndex.symbolPlaceholder')} aria-label={t('projectIndex.symbolSearch')}/><button type="button" onClick={onSearch} disabled={loading} aria-label={t('projectIndex.search')} title={t('projectIndex.search')}>{loading ? <LoaderCircle className="spin" size={14}/> : <Search size={14}/>}</button></div>{symbols.length ? <div className="project-index-symbols">{symbols.map((symbol) => <article key={symbol.id}><header><strong>{symbol.name}</strong>{symbol.exported && <Check size={13}/>}</header><small>{symbol.kind} · {symbol.relativePath}:{symbol.location.startLine} · {symbol.analyzedHash.slice(0, 8)}</small>{symbol.signature && <code>{symbol.signature}</code>}</article>)}</div> : <p className="project-index-muted">{query ? t('projectIndex.noSymbols') : t('projectIndex.searchHint')}</p>}</section>
    <section className="project-index-section"><h3><Play size={14}/>{t('projectIndex.validation')}</h3><div className="project-index-validation-actions">{validationKinds.map((kind) => <button key={kind} type="button" disabled={validationBusy} onClick={() => onValidation(kind)}>{t(`projectIndex.validation.${kind}`)}</button>)}{validationBusy && <button type="button" onClick={onValidationCancel}><Square size={12}/>{t('projectIndex.cancelValidation')}</button>}</div>{validationRuns.length ? <div className="project-index-validation-runs">{validationRuns.slice(0, 5).map((run) => <article key={run.id}><header><strong>{t(`projectIndex.validationStatus.${run.status}`)}</strong><small>{run.durationMs !== null ? `${run.durationMs} ms` : '—'}</small></header><code>{run.command ? [run.command, ...run.args].join(' ') : t('projectIndex.validationNotConfigured')}</code>{run.error && <p className="project-index-error"><TriangleAlert size={13}/>{run.error}</p>}{run.outputSummary && <details><summary>{t('projectIndex.validationOutput')}</summary><pre>{run.outputSummary}</pre></details>}</article>)}</div> : <p className="project-index-muted">{t('projectIndex.validationHint')}</p>}</section>
    {summary && summary.failedFiles > 0 && <p className="project-index-muted">{t('projectIndex.partialFailure', { count: summary.failedFiles })}</p>}
    {summary && summary.files > 0 && <small className="project-index-footnote">{t('projectIndex.hashHint')}</small>}
  </div>
}

const validationKinds: ValidationKind[] = ['typecheck', 'lint', 'test', 'build', 'smoke']

function StatusIcon({ status }: { status: ProjectIndexStatus | null }) {
  if (status?.status === 'queued' || status?.status === 'running') return <LoaderCircle className="spin" size={15}/>
  if (status?.status === 'completed') return <Check size={15}/>
  if (status?.status === 'failed') return <TriangleAlert size={15}/>
  return null
}

function statusLabel(status: ProjectIndexStatus['status'], t: (key: string, values?: Record<string, string | number>) => string) {
  return ({ queued: t('projectIndex.queued'), running: t('projectIndex.running'), completed: t('projectIndex.completed'), cancelled: t('projectIndex.cancelled'), failed: t('projectIndex.failed') } as Record<ProjectIndexStatus['status'], string>)[status]
}

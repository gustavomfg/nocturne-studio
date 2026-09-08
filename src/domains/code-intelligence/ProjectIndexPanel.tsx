import { useMemo } from 'react'
import { Check, FileCode2, LoaderCircle, Play, RefreshCw, Search, Sparkles, Square, TriangleAlert } from 'lucide-react'
import type { ProjectIndexStatus, ProjectIndexSummary, ProjectSymbol, StackEvidence, ValidationKind, ValidationRun } from '../../../shared/codeIntelligence'
import type { SemanticIndexStatus, SemanticIndexSummary, SemanticSearchResult } from '../../../shared/semanticIndex'
import type { EngineeringHealthReport, EngineeringHealthCategory, EngineeringInsight, HealthAssessmentStatus } from '../../../shared/engineeringIntelligence'
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
  semanticStatus: SemanticIndexStatus | null
  semanticSummary: SemanticIndexSummary | null
  semanticResults: SemanticSearchResult[]
  semanticQuery: string
  semanticLoading: boolean
  onSemanticQuery(value: string): void
  onSemanticSearch(): void
  onSemanticStart(): void
  onSemanticCancel(): void
  engineeringReport: EngineeringHealthReport | null
  activeConversationId: string | null
  onCreateSuggestion(insight: EngineeringInsight): void
  showTitle?: boolean
}

export function ProjectIndexPanel({ workspace, status, summary, stack, symbols, query, loading, onQuery, onSearch, onStart, onCancel, onRetry, validationRuns, validationLoading, onValidation, onValidationCancel, semanticStatus, semanticSummary, semanticResults, semanticQuery, semanticLoading, onSemanticQuery, onSemanticSearch, onSemanticStart, onSemanticCancel, engineeringReport, activeConversationId, onCreateSuggestion, showTitle = true }: ProjectIndexPanelProps) {
  const { t } = useI18n()
  const stackValues = useMemo(() => [...new Set(stack.filter((item) => item.category !== 'script' && item.category !== 'convention').map((item) => item.value))], [stack])
  const busy = status?.status === 'queued' || status?.status === 'running'
  const validationBusy = validationLoading || validationRuns[0]?.status === 'queued' || validationRuns[0]?.status === 'running'
  const progress = status && status.totalFiles > 0 ? Math.min(1, status.processedFiles / status.totalFiles) : 0
  const semanticBusy = semanticStatus?.status === 'queued' || semanticStatus?.status === 'running'
  const semanticProgress = semanticStatus && semanticStatus.totalFiles > 0 ? Math.min(1, semanticStatus.processedFiles / semanticStatus.totalFiles) : 0
  if (!workspace) return <div className="inspector-empty"><div><FileCode2 size={22}/></div><p>{t('projectIndex.noWorkspace')}</p></div>
  return <div className="project-index-panel">
    <section className="project-index-status" aria-label={showTitle ? undefined : t('projectIndex.title')} aria-live="polite">
      {showTitle && <header><div><FileCode2 size={15}/><strong>{t('projectIndex.title')}</strong></div><StatusIcon status={status}/></header>}
      {!status && <p>{t('projectIndex.waiting')}</p>}
      {status && <><div className="project-index-status-line"><span>{statusLabel(status.status, t)}</span><small>{status.processedFiles}/{status.totalFiles || '—'}</small></div><div className="project-index-progress"><span style={{ transform: `scaleX(${progress})` }}/></div>{status.currentPath && <small className="project-index-current">{status.currentPath}</small>}{status.error && <p className="project-index-error"><TriangleAlert size={13}/>{status.error}</p>}</>}
      <div className="project-index-actions">{busy ? <button type="button" onClick={onCancel}><Square size={13}/>{t('projectIndex.cancel')}</button> : <button type="button" onClick={onStart}><RefreshCw size={13}/>{t('projectIndex.reindex')}</button>}{status?.failedFiles ? <button type="button" onClick={onRetry}><RefreshCw size={13}/>{t('projectIndex.retry')}</button> : null}</div>
    </section>
    {engineeringReport && <EngineeringHealthSection report={engineeringReport} activeConversationId={activeConversationId} onCreateSuggestion={onCreateSuggestion}/>}
    {summary && <section className="project-index-section"><h3>{t('projectIndex.summary')}</h3><div className="project-index-metrics"><span><strong>{summary.files}</strong>{t('projectIndex.files')}</span><span><strong>{summary.symbols}</strong>{t('projectIndex.symbols')}</span><span><strong>{summary.imports + summary.exports}</strong>{t('projectIndex.relations')}</span></div></section>}
    <section className="project-index-section"><h3>{t('projectIndex.stack')}</h3>{stackValues.length ? <div className="project-index-tags">{stackValues.map((value) => <span key={value}>{value}</span>)}</div> : <p className="project-index-muted">{t('projectIndex.noStack')}</p>}{stack.length > 0 && <div className="project-index-evidence">{stack.slice(0, 6).map((item) => <div key={item.id}><small>{item.value} ← {item.sourcePath} · {item.sourceHash.slice(0, 8)}</small><span>{item.reason}</span></div>)}</div>}</section>
    <section className="project-index-section"><h3>{t('projectIndex.symbolSearch')}</h3><div className="project-index-search"><input value={query} onChange={(event) => onQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSearch() }} placeholder={t('projectIndex.symbolPlaceholder')} aria-label={t('projectIndex.symbolSearch')}/><button type="button" onClick={onSearch} disabled={loading} aria-label={t('projectIndex.search')} title={t('projectIndex.search')}>{loading ? <LoaderCircle className="spin" size={14}/> : <Search size={14}/>}</button></div>{symbols.length ? <div className="project-index-symbols">{symbols.map((symbol) => <article key={symbol.id}><header><strong>{symbol.name}</strong>{symbol.exported && <Check size={13}/>}</header><small>{symbol.kind} · {symbol.relativePath}:{symbol.location.startLine} · {symbol.analyzedHash.slice(0, 8)}</small>{symbol.signature && <code>{symbol.signature}</code>}</article>)}</div> : <p className="project-index-muted">{query ? t('projectIndex.noSymbols') : t('projectIndex.searchHint')}</p>}</section>
    <section className="project-index-section project-index-semantic"><h3><Sparkles size={14}/>{t('projectIndex.semantic')}</h3>{semanticStatus && <><div className="project-index-status-line"><span>{semanticStatusLabel(semanticStatus.status, t)}</span><small>{semanticStatus.processedFiles}/{semanticStatus.totalFiles || '—'}</small></div><div className="project-index-progress"><span style={{ transform: `scaleX(${semanticProgress})` }}/></div>{semanticStatus.currentPath && <small className="project-index-current">{semanticStatus.currentPath}</small>}</>}{semanticSummary && <div className="project-index-metrics project-index-semantic-metrics"><span><strong>{semanticSummary.units}</strong>{t('projectIndex.semanticUnits')}</span><span><strong>{semanticSummary.indexedUnits}</strong>{t('projectIndex.semanticVectors')}</span><span><strong>{semanticSummary.lexicalOnlyUnits}</strong>{t('projectIndex.semanticLexical')}</span></div>}<div className="project-index-actions">{semanticBusy ? <button type="button" onClick={onSemanticCancel}><Square size={13}/>{t('projectIndex.cancel')}</button> : <button type="button" onClick={onSemanticStart}><RefreshCw size={13}/>{t('projectIndex.semanticReindex')}</button>}</div><div className="project-index-search"><input value={semanticQuery} onChange={(event) => onSemanticQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSemanticSearch() }} placeholder={t('projectIndex.semanticPlaceholder')} aria-label={t('projectIndex.semanticSearch')}/><button type="button" onClick={onSemanticSearch} disabled={semanticLoading || !semanticQuery.trim()} aria-label={t('projectIndex.semanticSearch')} title={t('projectIndex.semanticSearch')}>{semanticLoading ? <LoaderCircle className="spin" size={14}/> : <Search size={14}/>}</button></div>{semanticResults.length ? <div className="project-index-symbols project-index-semantic-results">{semanticResults.map((result) => <article key={result.unit.id}><header><strong>{result.unit.symbolName ?? result.unit.relativePath}</strong><small>{result.scores.final.toFixed(2)}</small></header><small>{result.unit.kind} · {result.unit.relativePath}:{result.unit.location.startLine} · {result.unit.sourceHash.slice(0, 8)}</small><span>{result.provenance.reason}</span><code>{result.excerpt}</code></article>)}</div> : <p className="project-index-muted">{semanticQuery ? t('projectIndex.noSemanticResults') : t('projectIndex.semanticHint')}</p>}</section>
    <section className="project-index-section"><h3><Play size={14}/>{t('projectIndex.validation')}</h3><div className="project-index-validation-actions">{validationKinds.map((kind) => <button key={kind} type="button" disabled={validationBusy} onClick={() => onValidation(kind)}>{t(`projectIndex.validation.${kind}`)}</button>)}{validationBusy && <button type="button" onClick={onValidationCancel}><Square size={12}/>{t('projectIndex.cancelValidation')}</button>}</div>{validationRuns.length ? <div className="project-index-validation-runs">{validationRuns.slice(0, 5).map((run) => <article key={run.id}><header><strong>{t(`projectIndex.validationStatus.${run.status}`)}</strong><small>{run.durationMs !== null ? `${run.durationMs} ms` : '—'}</small></header><code>{run.command ? [run.command, ...run.args].join(' ') : t('projectIndex.validationNotConfigured')}</code>{run.error && <p className="project-index-error"><TriangleAlert size={13}/>{run.error}</p>}{run.outputSummary && <details><summary>{t('projectIndex.validationOutput')}</summary><pre>{run.outputSummary}</pre></details>}</article>)}</div> : <p className="project-index-muted">{t('projectIndex.validationHint')}</p>}</section>
    {summary && summary.failedFiles > 0 && <p className="project-index-muted">{t('projectIndex.partialFailure', { count: summary.failedFiles })}</p>}
    {summary && summary.files > 0 && <small className="project-index-footnote">{t('projectIndex.hashHint')}</small>}
  </div>
}

function EngineeringHealthSection({ report, activeConversationId, onCreateSuggestion }: { report: EngineeringHealthReport; activeConversationId: string | null; onCreateSuggestion(insight: EngineeringInsight): void }) {
  const { t } = useI18n()
  const categories = report.snapshot.categories
  return <section className="project-index-section engineering-health" aria-live="polite">
    <div className="engineering-health-heading"><h3>{t('engineeringHealth.title')}</h3><small>{t('engineeringHealth.policy', { version: report.snapshot.policyVersion })}</small></div>
    <div className="engineering-health-grid">{categories.map((category) => <article key={category.category} className={`engineering-health-category ${category.status}`}><strong>{categoryLabel(category.category, t)}</strong><span>{statusLabelForHealth(category.status, t)}</span>{category.score !== null && <b>{category.score}/100</b>}<small>{t('engineeringHealth.evidence', { count: category.coverage.available })}</small></article>)}</div>
    {report.signals.length > 0 && <div className="engineering-health-findings"><strong>{t('engineeringHealth.findings')}</strong>{report.signals.slice(0, 5).map((signal) => <div key={signal.fingerprint}><span>{signal.title}</span><small>{signal.evidence[0]?.relativePath ?? signal.evidence[0]?.source} · {t('engineeringHealth.confidence', { count: signal.confidence })}</small></div>)}</div>}
    {report.insights.length > 0 && <div className="engineering-health-findings"><strong>{t('engineeringHealth.insights')}</strong>{report.insights.slice(0, 3).map((insight) => <div key={insight.fingerprint}><span>{insight.title}</span><small>{insight.explanation}</small><button type="button" className="engineering-health-action" disabled={!activeConversationId} onClick={() => onCreateSuggestion(insight)}>{activeConversationId ? t('engineeringHealth.createSuggestion') : t('engineeringHealth.noConversation')}</button></div>)}</div>}
    {report.trends.length > 0 && <div className="engineering-health-findings"><strong>{t('engineeringHealth.trends')}</strong>{report.trends.slice(0, 4).map((trend) => <div key={trend.id}><span>{trend.category}</span><small>{trend.kind}</small></div>)}</div>}
  </section>
}

function categoryLabel(category: EngineeringHealthCategory, t: (key: string, values?: Record<string, string | number>) => string) {
  return t(`engineeringHealth.category.${category}`)
}

function statusLabelForHealth(status: HealthAssessmentStatus, t: (key: string, values?: Record<string, string | number>) => string) {
  return t(`engineeringHealth.status.${status}`)
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

function semanticStatusLabel(status: SemanticIndexStatus['status'], t: (key: string, values?: Record<string, string | number>) => string) {
  return ({ queued: t('projectIndex.queued'), running: t('projectIndex.running'), completed: t('projectIndex.semanticCompleted'), cancelled: t('projectIndex.cancelled'), failed: t('projectIndex.semanticFailed') } as Record<SemanticIndexStatus['status'], string>)[status]
}

import { useEffect, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Activity as ActivityIcon, Check, Eye, FileCode2, FileDown, GitBranch, ListChecks, LoaderCircle, PackageOpen, ShieldCheck, Trash2, X } from 'lucide-react'
import type { Artifact, GitInfo, PlanStep, Suggestion, SuggestionStatus } from '../../types'
import { useAppStore } from '../../store'
import { relativeTime } from '../../shared/format'
import { SuggestionsPanel } from '../suggestions/SuggestionsPanel'
import { useOffCanvasPanel } from '../../shared/useOffCanvasPanel'
import { useI18n } from '../../shared/i18n'
import { useRendererRenderCounter } from '../../shared/rendererDiagnostics'
import { AgentActivityPanel } from './AgentActivityPanel'
import { ProjectIndexPanel, type ProjectIndexPanelProps } from '../code-intelligence/ProjectIndexPanel'

interface AgentPanelProps {
  open: boolean
  compact: boolean
  triggerRef: RefObject<HTMLElement | null>
  gitInfo: GitInfo | null
  artifactsHaveMore: boolean
  suggestionsHaveMore: boolean
  loadingCollection: 'conversations' | 'artifacts' | 'suggestions' | null
  onClose(): void
  onDecide(key: string, accepted: boolean): void
  onError(value: string): void
  onNotify(value: string): void
  onGitRefresh(): void
  onArtifactsRefresh(): void
  onLoadMoreArtifacts(): void
  onLoadMoreSuggestions(): void
  onPreview(filePath: string): void
  onArtifact(artifact: Artifact): void
  onDeleteArtifact(id: string): void
  onSuggestionStatus(suggestion: Suggestion, status: SuggestionStatus): void
  onSuggestionApply(suggestion: Suggestion): void
  onPlanChange(plan: PlanStep[]): void
  onPlanExecute(plan: PlanStep[]): void
  projectIndex: ProjectIndexPanelProps
}

const tabs = ['activity', 'plan', 'suggestions', 'artifacts', 'project'] as const
type AgentPanelTab = typeof tabs[number]

export function AgentPanel({ open: isOpen, compact, triggerRef, gitInfo, artifactsHaveMore, suggestionsHaveMore, loadingCollection, onClose, onDecide, onError, onNotify, onGitRefresh, onArtifactsRefresh, onLoadMoreArtifacts, onLoadMoreSuggestions, onPreview, onArtifact, onDeleteArtifact, onSuggestionStatus, onSuggestionApply, onPlanChange, onPlanExecute, projectIndex }: AgentPanelProps) {
  useRendererRenderCounter('agentPanel')
  const { t } = useI18n()
  const { running, planCount, suggestionsCount, artifactsCount } = useAppStore(useShallow((state) => ({
    running: state.activities.some((activity) => activity.status === 'running'),
    planCount: state.plan.length,
    suggestionsCount: state.suggestions.length,
    artifactsCount: state.artifacts.length,
  })))
  const [tab, setTab] = useState<AgentPanelTab>('activity')
  const inspectorRef = useOffCanvasPanel<HTMLElement>({ open: isOpen, modal: compact, onClose, triggerRef })

  useEffect(() => {
    if (inspectorRef.current) inspectorRef.current.inert = !isOpen
  }, [inspectorRef, isOpen])

  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    setTab(tabs[next])
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  return <aside id="agent-inspector" ref={inspectorRef} className={`inspector ${isOpen ? 'open' : 'closed'}`} aria-hidden={!isOpen} role={compact && isOpen ? 'dialog' : undefined} aria-modal={compact && isOpen ? true : undefined} aria-label={compact && isOpen ? t('agent.panel') : undefined} tabIndex={-1}>
    <div className="inspector-header"><div><ActivityIcon size={16}/><strong>{t('agent.name')}</strong></div><span>{running ? t('agent.running') : t('agent.idle')}</span>{compact && <button className="inspector-close" aria-label={t('agent.closePanel')} title={t('agent.closePanel')} onClick={onClose}><X size={16}/></button>}</div>
    <div className="inspector-tabs" role="tablist" aria-label={t('agent.panel')}>
      <TabButton id="activity" index={0} selected={tab === 'activity'} onKeyDown={moveTab} onSelect={setTab} icon={<ActivityIcon size={12}/>} label={t('agent.activity')}/>
      <TabButton id="plan" index={1} selected={tab === 'plan'} onKeyDown={moveTab} onSelect={setTab} icon={<ListChecks size={12}/>} label={t('agent.plan')} count={planCount}/>
      <TabButton id="suggestions" index={2} selected={tab === 'suggestions'} onKeyDown={moveTab} onSelect={setTab} icon={<ShieldCheck size={12}/>} label={t('agent.suggestions')} count={suggestionsCount}/>
      <TabButton id="artifacts" index={3} selected={tab === 'artifacts'} onKeyDown={moveTab} onSelect={setTab} icon={<PackageOpen size={12}/>} label={t('agent.artifacts')} count={artifactsCount}/>
      <TabButton id="project" index={4} selected={tab === 'project'} onKeyDown={moveTab} onSelect={setTab} icon={<FileCode2 size={12}/>} label={t('projectIndex.tab')} ariaLabel={t('projectIndex.title')}/>
    </div>
    <div className="inspector-scroll">
      <div id="agent-panel-activity" aria-labelledby="agent-tab-activity" className="tab-panel activity-panel" role="tabpanel" hidden={tab !== 'activity'}><AgentActivityPanel gitInfo={gitInfo} onDecide={onDecide} onError={onError} onNotify={onNotify} onGitRefresh={onGitRefresh} onArtifactsRefresh={onArtifactsRefresh} onPreview={onPreview}/></div>
      {tab === 'plan' && <div id="agent-panel-plan" aria-labelledby="agent-tab-plan" role="tabpanel"><PlanTab onChange={onPlanChange} onExecute={onPlanExecute}/></div>}
      {tab === 'suggestions' && <div id="agent-panel-suggestions" aria-labelledby="agent-tab-suggestions" role="tabpanel"><SuggestionsTab hasMore={suggestionsHaveMore} loadingMore={loadingCollection === 'suggestions'} onLoadMore={onLoadMoreSuggestions} onStatus={onSuggestionStatus} onApply={onSuggestionApply} onOpenFile={onPreview} onNotify={onNotify}/></div>}
      {tab === 'artifacts' && <div id="agent-panel-artifacts" aria-labelledby="agent-tab-artifacts" role="tabpanel"><ArtifactsTab hasMore={artifactsHaveMore} loadingMore={loadingCollection === 'artifacts'} onLoadMore={onLoadMoreArtifacts} onOpen={onArtifact} onDelete={onDeleteArtifact}/></div>}
      {tab === 'project' && <div id="agent-panel-project" aria-labelledby="agent-tab-project" role="tabpanel"><ProjectIndexPanel {...projectIndex}/></div>}
    </div>
  </aside>
}

function TabButton({ id, index, selected, onKeyDown, onSelect, icon, label, count, ariaLabel }: { id: AgentPanelTab; index: number; selected: boolean; onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void; onSelect(tab: AgentPanelTab): void; icon: ReactNode; label: string; count?: number; ariaLabel?: string }) {
  return <button id={`agent-tab-${id}`} role="tab" aria-label={ariaLabel} title={ariaLabel ?? label} aria-controls={`agent-panel-${id}`} aria-selected={selected} tabIndex={selected ? 0 : -1} className={selected ? 'active' : ''} onKeyDown={(event) => onKeyDown(event, index)} onClick={() => onSelect(id)}>{icon}<span className="tab-label">{label}</span>{count ? <span className="tab-count">{count}</span> : null}</button>
}

function PlanTab({ onChange, onExecute }: { onChange(plan: PlanStep[]): void; onExecute(plan: PlanStep[]): void }) {
  const { plan, explanation } = useAppStore(useShallow((state) => ({ plan: state.plan, explanation: state.planExplanation })))
  return <PlanPanel plan={plan} explanation={explanation} onChange={onChange} onExecute={onExecute}/>
}

function SuggestionsTab({ hasMore, loadingMore, onLoadMore, onStatus, onApply, onOpenFile, onNotify }: { hasMore: boolean; loadingMore: boolean; onLoadMore(): void; onStatus(suggestion: Suggestion, status: SuggestionStatus): void; onApply(suggestion: Suggestion): void; onOpenFile(filePath: string): void; onNotify(value: string): void }) {
  const suggestions = useAppStore((state) => state.suggestions)
  return <SuggestionsPanel suggestions={suggestions} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={onLoadMore} onStatus={onStatus} onApply={onApply} onOpenFile={onOpenFile} onNotify={onNotify}/>
}

function ArtifactsTab({ hasMore, loadingMore, onLoadMore, onOpen, onDelete }: { hasMore: boolean; loadingMore: boolean; onLoadMore(): void; onOpen(artifact: Artifact): void; onDelete(id: string): void }) {
  const artifacts = useAppStore((state) => state.artifacts)
  return <ArtifactsPanel artifacts={artifacts} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={onLoadMore} onOpen={onOpen} onDelete={onDelete}/>
}

function PlanPanel({ plan, explanation, onChange, onExecute }: { plan: PlanStep[]; explanation: string; onChange(plan: PlanStep[]): void; onExecute(plan: PlanStep[]): void }) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  const completed = plan.filter((item) => item.status === 'completed').length
  if (!plan.length) return <div className="inspector-empty"><div><ListChecks size={22}/></div><p>{t('agent.noPlan')}</p><small>{t('agent.noPlanHint')}</small></div>
  return <div className="plan-panel"><div className="plan-progress"><div><strong>{t('agent.planProgress')}</strong><span>{completed}/{plan.length}</span></div><div className="progress-track"><span style={{ transform: `scaleX(${completed / plan.length})` }}/></div>{explanation && <p>{explanation}</p>}</div><div className="plan-list">{plan.map((item, index) => <div className={`plan-step ${item.status}`} key={`${index}-${item.step}`}><span>{item.status === 'completed' ? <Check size={12}/> : item.status === 'inProgress' ? <LoaderCircle size={12}/> : index + 1}</span><div>{editing ? <input value={item.step} onChange={(event) => onChange(plan.map((entry, entryIndex) => entryIndex === index ? { ...entry, step: event.target.value } : entry))}/> : <strong>{item.step}</strong>}<small>{item.status === 'completed' ? t('agent.completed') : item.status === 'inProgress' ? t('agent.inProgress') : t('agent.pending')}</small></div></div>)}</div><div className="plan-actions"><button onClick={() => setEditing(!editing)}>{editing ? t('agent.finishEditing') : t('agent.editPlan')}</button><button className="primary" onClick={() => onExecute(plan)} disabled={editing || !plan.every((item) => item.step.trim())}>{t('agent.prepareExecution')}</button></div></div>
}

function ArtifactsPanel({ artifacts, hasMore, loadingMore, onLoadMore, onOpen, onDelete }: { artifacts: Artifact[]; hasMore: boolean; loadingMore: boolean; onLoadMore(): void; onOpen(artifact: Artifact): void; onDelete(id: string): void }) {
  const { t, language } = useI18n()
  if (!artifacts.length) return <div className="inspector-empty"><div><PackageOpen size={22}/></div><p>{t('agent.noArtifacts')}</p><small>{t('agent.noArtifactsHint')}</small></div>
  return <div className="artifact-list">{artifacts.map((artifact) => <div className="artifact-card" key={artifact.id}><button className="artifact-main" onClick={() => onOpen(artifact)}><span className={`artifact-icon ${artifact.type}`}>{artifact.type === 'file' ? <FileCode2 size={15}/> : artifact.type === 'diff' ? <GitBranch size={15}/> : <FileDown size={15}/>}</span><span><strong>{artifact.title}</strong><small>{artifact.type} · {relativeTime(artifact.updatedAt, language)}</small></span><Eye size={13}/></button><button className="artifact-delete" aria-label={`${t('common.removeArtifact')} ${artifact.title}`} title={t('common.remove')} onClick={() => onDelete(artifact.id)}><Trash2 size={12}/></button></div>)}{hasMore && <button className="collection-load-more" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? t('common.loading') : t('agent.loadOlderArtifacts')}</button>}</div>
}

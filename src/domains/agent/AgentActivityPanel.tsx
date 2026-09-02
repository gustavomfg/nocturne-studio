import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Activity as ActivityIcon, Check, Command, Eye, ExternalLink, FileCode2, FileDown, FolderOpen, GitBranch, LoaderCircle, RotateCcw, ShieldCheck, Sparkles, X } from 'lucide-react'
import type { Activity, Approval, BuildRollbackStatus, ChangedFile, DocumentUpdatePreview, GitInfo } from '../../types'
import { useAppStore } from '../../store'
import { errorMessage } from '../../shared/format'
import { parseAwarenessSnapshot } from '../../../shared/awareness'
import { useI18n } from '../../shared/i18n'
import { DocumentUpdateDialog } from './DocumentUpdateDialog'
import { GitPanel } from '../git/GitPanel'
import { useRendererRenderCounter } from '../../shared/rendererDiagnostics'

interface AgentActivityPanelProps {
  gitInfo: GitInfo | null
  onDecide(key: string, accepted: boolean): void
  onError(value: string): void
  onNotify(value: string): void
  onGitRefresh(): void
  onArtifactsRefresh(): void
  onPreview(filePath: string): void
}

export function AgentActivityPanel({ gitInfo, onDecide, onError, onNotify, onGitRefresh, onArtifactsRefresh, onPreview }: AgentActivityPanelProps) {
  useRendererRenderCounter('agentActivity')
  const { t, language } = useI18n()
  const { activities, approvals, diff, files, activeId, documentContent, awarenessMetadata } = useAppStore(useShallow((state) => ({
    activities: state.activities,
    approvals: state.approvals,
    diff: state.diff,
    files: state.files,
    activeId: state.activeId,
    documentContent: [...state.messages].reverse().find((message) => message.role === 'assistant')?.content || '',
    awarenessMetadata: [...state.messages].reverse().find((message) => message.role === 'user')?.metadata ?? null,
  })))
  const awareness = useMemo(() => parseAwarenessSnapshot(awarenessMetadata), [awarenessMetadata])
  const [exporting, setExporting] = useState<string | null>(null)
  const [rollback, setRollback] = useState<BuildRollbackStatus | null>(null)
  const [rollingBack, setRollingBack] = useState(false)
  const [documentDraft, setDocumentDraft] = useState<DocumentUpdatePreview | null>(null)
  const [applyingDocument, setApplyingDocument] = useState(false)
  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending')
  const resolvedApprovals = approvals.filter((approval) => approval.status !== 'pending')
  const currentActivity = [...activities].reverse().find((activity) => activity.status === 'running') ?? activities[activities.length - 1]

  const open = async (filePath: string, action: 'file' | 'folder' | 'editor') => {
    if (!activeId) return
    try {
      await window.nocturne.files.open(activeId, filePath, action)
      onNotify(action === 'folder' ? t('common.openFolder') : t('common.openFile'))
    } catch (error) {
      onError(errorMessage(error))
    }
  }

  const exportDocument = async (format: 'md' | 'docx' | 'pdf' | 'html') => {
    if (!activeId || !documentContent || exporting) {
      if (!documentContent) onError(t('agent.noMarkdownResponse'))
      return
    }
    setExporting(format)
    try {
      if (format === 'md') {
        const preview = await window.nocturne.documents.prepareMarkdown(activeId, documentContent)
        if (preview) setDocumentDraft(preview)
      } else {
        const result = await window.nocturne.documents.export(activeId, documentContent, format)
        if (result) {
          onArtifactsRefresh()
          onNotify(t('agent.documentExported', { format: format.toUpperCase() }))
        }
      }
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setExporting(null)
    }
  }

  useEffect(() => {
    let active = true
    if (!activeId) {
      setRollback(null)
      return () => { active = false }
    }
    void window.nocturne.ai.rollbackStatus(activeId)
      .then((status) => { if (active) setRollback(status) })
      .catch(() => { if (active) setRollback(null) })
    return () => { active = false }
  }, [activeId, currentActivity?.status, files.length])

  const rollbackBuild = async () => {
    if (!activeId || rollingBack) return
    setRollingBack(true)
    try {
      const result = await window.nocturne.ai.rollback(activeId)
      if (result) {
        setRollback(await window.nocturne.ai.rollbackStatus(activeId))
        onGitRefresh()
        onNotify(t('agent.filesRestored', { count: result.restored.length }))
      }
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setRollingBack(false)
    }
  }

  const applyDocument = async (strategy: 'append' | 'replace') => {
    if (!activeId || !documentDraft || applyingDocument) return
    setApplyingDocument(true)
    try {
      const result = await window.nocturne.documents.applyMarkdown(activeId, documentDraft, strategy)
      if (result) {
        setDocumentDraft(null)
        onArtifactsRefresh()
        onNotify(strategy === 'append' ? t('docs.attached') : t('docs.saved'))
      }
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      setApplyingDocument(false)
    }
  }

  return <>
    {(pendingApprovals.length > 0 || currentActivity) && <section className="activity-priority agent-priority-block" aria-labelledby="agent-priority-title"><h2 id="agent-priority-title"><ShieldCheck size={15}/>{pendingApprovals.length > 0 ? t('agent.nextAction') : t('agent.currentOperation')}</h2>{currentActivity && <div className={`current-operation ${currentActivity.status}`} role="status" aria-live="polite"><span>{currentActivity.status === 'running' ? <LoaderCircle size={15}/> : currentActivity.status === 'failed' ? <X size={15}/> : <Check size={15}/>}</span><div><small>{t('agent.currentState')}</small><strong>{currentActivity.label}</strong></div></div>}{pendingApprovals.length > 0 && <section aria-labelledby="pending-approvals-title"><h3 id="pending-approvals-title">{t('agent.pendingDecisions')} <span>{pendingApprovals.length}</span></h3><p className="priority-hint">{t('agent.pendingApprovalHint')}</p>{pendingApprovals.map((approval) => <ApprovalCard key={approval.key} approval={approval} onDecide={onDecide}/>)}</section>}</section>}
    <ActivityTimeline activities={activities}/>
    {awareness && <details className="activity-section awareness-section"><summary><Sparkles size={14}/>{t('agent.contextUsed')} <span>{awareness.selections.length}</span></summary><div className="awareness-panel">{awareness.selections.length ? awareness.selections.map((selection) => <article key={`${selection.source}-${selection.id}`}><header><strong>{selection.title}</strong><span>{selection.relevance}% {t('agent.relevant')}</span></header><p>{selection.reason}</p><small>{t('agent.source')}: {awarenessSourceLabel(selection.sourceType, t)} · {t('agent.scope')}: {selection.scope === 'conversation' ? t('agent.conversation') : t('agent.workspace')}{selection.updatedAt ? ` · ${t('agent.updatedAt')} ${new Date(selection.updatedAt).toLocaleString(language === 'en' ? 'en-US' : 'pt-BR')}` : ''}</small><details><summary>{t('agent.usedExcerpt')}</summary><pre>{selection.contentPreview}</pre></details></article>) : <p>{t('agent.noRelevantMemory')}</p>}</div></details>}
    {rollback?.createdAt && <details className="activity-section"><summary><RotateCcw size={14}/>{t('agent.lastBuildRollback')}</summary><div className="document-panel"><p>{rollback.available ? t('agent.canRestoreFiles', { count: rollback.files.length }) : rollback.reason}</p><button disabled={!rollback.available || rollingBack} onClick={() => void rollbackBuild()}>{rollingBack ? t('agent.reverting') : t('agent.revertChanges')}</button></div></details>}
    {!!files.length && <details className="activity-section" open><summary><FileCode2 size={14}/>{t('agent.changedFiles')} <span>{files.length}</span></summary><div className="files-panel">{files.slice(-300).map((file) => <ChangedFileRow key={file.path} file={file} onPreview={onPreview} onOpen={open}/>)}</div></details>}
    {diff && <DiffSection diff={diff}/>}
    {gitInfo && <details className="activity-section"><summary><GitBranch size={14}/>{t('agent.gitCommit')}</summary><GitPanel activeId={activeId} gitInfo={gitInfo} onRefresh={onGitRefresh} onError={onError} onNotify={onNotify}/></details>}
    <details className="activity-section"><summary><FileDown size={14}/>{t('agent.exportResponse')}</summary><div className="document-panel"><div className="export-actions"><button disabled={Boolean(exporting)} aria-label={t('agent.exportMarkdown')} onClick={() => void exportDocument('md')}>{exporting === 'md' ? '…' : 'MD'}</button><button disabled={Boolean(exporting)} aria-label={t('agent.exportHtml')} onClick={() => void exportDocument('html')}>{exporting === 'html' ? '…' : 'HTML'}</button><button disabled={Boolean(exporting)} aria-label={t('agent.exportDocx')} onClick={() => void exportDocument('docx')}>{exporting === 'docx' ? '…' : 'DOCX'}</button><button disabled={Boolean(exporting)} aria-label={t('agent.exportPdf')} onClick={() => void exportDocument('pdf')}>{exporting === 'pdf' ? '…' : 'PDF'}</button></div></div></details>
    {!!resolvedApprovals.length && <details className="activity-section"><summary><ShieldCheck size={14}/>{t('agent.decisionHistory')} <span>{resolvedApprovals.length}</span></summary>{resolvedApprovals.map((approval) => <ApprovalCard key={approval.key} approval={approval} onDecide={onDecide}/>)}</details>}
    {!activities.length && !approvals.length && !diff && <div className="inspector-empty"><div><ActivityIcon size={22}/></div><p>{t('agent.emptyActivity')}</p><small>{t('agent.emptyActivityHint')}</small></div>}
    {documentDraft && <DocumentUpdateDialog preview={documentDraft} busy={applyingDocument} onClose={() => setDocumentDraft(null)} onApply={(strategy) => void applyDocument(strategy)}/>}
  </>
}

function ChangedFileRow({ file, onPreview, onOpen }: { file: ChangedFile; onPreview(filePath: string): void; onOpen(filePath: string, action: 'file' | 'folder' | 'editor'): void }) {
  const { t } = useI18n()
  return <div className="changed-file"><span className={`file-kind ${file.kind}`}>{file.kind[0].toUpperCase()}</span><button aria-label={`${t('agent.view')} ${file.path}`} onClick={() => onPreview(file.path)}>{file.path.split(/[/\\]/).pop()}</button><button aria-label={`${t('agent.previewFile')} ${file.path}`} title={t('agent.previewFile')} onClick={() => onPreview(file.path)}><Eye size={12}/></button><button aria-label={`${t('agent.openInEditor')} ${file.path}`} title={t('agent.openInEditor')} onClick={() => void onOpen(file.path, 'editor')}><ExternalLink size={12}/></button><button aria-label={`${t('agent.showInFolder')} ${file.path}`} title={t('agent.showInFolder')} onClick={() => void onOpen(file.path, 'folder')}><FolderOpen size={12}/></button></div>
}

function ApprovalCard({ approval, onDecide }: { approval: Approval; onDecide(key: string, accepted: boolean): void }) {
  const { t } = useI18n()
  return <div className={`approval-card ${approval.status}`}><div className="approval-title"><span>{approval.kind === 'command' ? <Command size={15}/> : <FileCode2 size={15}/>}</span><strong>{approval.title}</strong></div><pre>{approval.detail}</pre>{approval.status === 'pending' ? <div className="approval-actions"><button onClick={() => onDecide(approval.key, false)}><X size={14}/>{t('agent.refuse')}</button><button className="accept" onClick={() => onDecide(approval.key, true)}><Check size={14}/>{t('agent.approve')}</button></div> : <small>{approval.status === 'accepted' ? t('agent.approved') : t('agent.declined')}</small>}</div>
}

function ActivityTimeline({ activities }: { activities: Activity[] }) {
  const { t } = useI18n()
  const [details, setDetails] = useState(false)
  const visible = activities.slice(-120)
  return <><div className="activity-detail-toggle"><button onClick={() => setDetails(!details)}>{details ? t('agent.hideTechnicalDetails') : t('agent.technicalDetails')}</button></div>{activities.length > visible.length && <small className="activity-limit-note">{t('agent.recentActivities')}</small>}<div className="timeline">{visible.map((item) => <div className="timeline-item" key={item.id}><span className={`timeline-dot ${item.status}`}>{item.status === 'running' ? <LoaderCircle size={13}/> : item.type === 'command' ? <Command size={12}/> : item.type === 'file' ? <FileCode2 size={12}/> : <Sparkles size={12}/>}</span><div><strong>{item.label}</strong>{details && item.detail && <pre>{item.detail.slice(0, 1400)}</pre>}</div></div>)}</div></>
}

function DiffSection({ diff }: { diff: string }) {
  const { t, language } = useI18n()
  const [open, setOpen] = useState(false)
  const limit = 300_000
  const truncated = diff.length > limit
  return <details className="activity-section" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary><FileCode2 size={14}/>{t('agent.proposedChanges')}</summary>{open && <div className="diff-panel">{truncated && <small>{t('agent.truncatedDiff')} ({limit.toLocaleString(language === 'en' ? 'en-US' : 'pt-BR')})</small>}<pre>{truncated ? diff.slice(-limit) : diff}</pre></div>}</details>
}

function awarenessSourceLabel(source: string, t: (key: string) => string) {
  return ({ workspace: t('awareness.workspace'), manual: t('awareness.manual'), message: t('awareness.message'), agent: t('awareness.agent'), 'project-index': t('awareness.projectIndex') } as Record<string, string>)[source] ?? source
}

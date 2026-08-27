import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Archive, Brain, Check, History, Pencil, Plus, RotateCcw, Search, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react'
import type { BrainMemory, BrainMemoryHistoryEntry, BrainMemoryKind, BrainMemoryScope, BrainMemoryStatus } from '../../../shared/brainMemory'
import { errorMessage, relativeTime } from '../../shared/format'
import { useDialogA11y } from '../../shared/useDialogA11y'
import { useI18n } from '../../shared/i18n'

const memoryKinds: BrainMemoryKind[] = ['fact', 'decision', 'preference', 'constraint', 'learning']
const memoryStatuses: BrainMemoryStatus[] = ['candidate', 'active', 'outdated', 'archived']

export function BrainMemoryDialog({ conversationId, onClose, onNotify }: { conversationId: string; onClose(): void; onNotify(message: string): void }) {
  const { t, language } = useI18n()
  const [items, setItems] = useState<BrainMemory[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<BrainMemoryStatus | 'all'>('all')
  const [content, setContent] = useState('')
  const [kind, setKind] = useState<BrainMemoryKind>('fact')
  const [scope, setScope] = useState<BrainMemoryScope>('workspace')
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<'library' | 'create'>('library')
  const [history, setHistory] = useState<Record<string, BrainMemoryHistoryEntry[]>>({})
  const [historyOpen, setHistoryOpen] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState<string | null>(null)
  const dialogRef = useDialogA11y<HTMLDivElement>(onClose)

  const load = useCallback(async (offset = 0, append = false) => {
    setLoading(true); setError(null)
    try {
      const page = await window.nocturne.brain.page(conversationId, offset, 50, search, filter === 'all' ? undefined : filter)
      setItems((current) => append ? [...current, ...page.items] : page.items); setHasMore(page.hasMore)
    } catch (loadError) { setError(errorMessage(loadError)) } finally { setLoading(false) }
  }, [conversationId, filter, search])

  useEffect(() => { void load() }, [load])

  const submitSearch = (event: FormEvent) => { event.preventDefault(); setSearch(query.trim()) }
  const create = async (event: FormEvent) => {
    event.preventDefault(); if (saving || !content.trim()) return
    setSaving(true); setError(null)
    try {
      await window.nocturne.brain.create(conversationId, { kind, scope, content: content.trim() })
      setContent(''); await load(); onNotify(t('memory.candidateCreated'))
    } catch (createError) { setError(errorMessage(createError)) } finally { setSaving(false) }
  }
  const update = async (memory: BrainMemory, value: Parameters<typeof window.nocturne.brain.update>[2], message: string) => {
    if (saving) return; setSaving(true); setError(null)
    try { await window.nocturne.brain.update(conversationId, memory.id, value); setEditing(null); setConfirmDelete(null); await load(); onNotify(message) }
    catch (updateError) { setError(errorMessage(updateError)) } finally { setSaving(false) }
  }
  const remove = async (memory: BrainMemory) => {
    if (confirmDelete !== memory.id) { setConfirmDelete(memory.id); return }
    setSaving(true); setError(null)
    try { await window.nocturne.brain.delete(conversationId, memory.id); setConfirmDelete(null); await load(); onNotify(t('memory.deletedPermanently')) }
    catch (deleteError) { setError(errorMessage(deleteError)) } finally { setSaving(false) }
  }
  const toggleHistory = async (memory: BrainMemory) => {
    if (historyOpen === memory.id) { setHistoryOpen(null); return }
    setHistoryOpen(memory.id)
    if (history[memory.id]) return
    setHistoryLoading(memory.id); setError(null)
    try {
      const entries = await window.nocturne.brain.history(conversationId, memory.id)
      setHistory((current) => ({ ...current, [memory.id]: entries }))
    } catch (historyError) { setError(errorMessage(historyError)) } finally { setHistoryLoading(null) }
  }

  const candidateCount = items.filter((memory) => memory.status === 'candidate').length
  return <div className="modal-backdrop" onMouseDown={onClose}><div ref={dialogRef} className="settings-dialog brain-dialog" role="dialog" aria-modal="true" aria-labelledby="brain-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
    <header className="modal-title brain-header"><span className="brain-mark" aria-hidden="true"><Brain size={20}/></span><span className="brain-title-copy"><strong id="brain-title">{t('memory.secondBrain')}</strong><small>{t('memory.secondBrainSubtitle')}</small></span><span className="brain-trust"><ShieldCheck size={15}/><span><strong>{t('memory.humanApproval')}</strong><small>{t('memory.activeOnly')}</small></span></span><button className="brain-close" aria-label={`${t('common.close')} ${t('memory.secondBrain')}`} title={t('common.close')} onClick={onClose}><X size={17}/></button></header>
    <nav className="brain-mobile-tabs" role="tablist" aria-label={t('memory.secondBrainSections')}><button role="tab" aria-selected={mobileView === 'library'} onClick={() => setMobileView('library')}>{t('memory.library')}</button><button role="tab" aria-selected={mobileView === 'create'} onClick={() => setMobileView('create')}>{t('memory.create')}</button></nav>
    <div className="brain-layout" data-mobile-view={mobileView}>
      <form className="brain-create" onSubmit={(event) => void create(event)} aria-labelledby="brain-create-title">
        <div className="brain-create-heading"><span><Sparkles size={16}/></span><div><strong id="brain-create-title">{t('memory.capture')}</strong><p>{t('memory.captureHint')}</p></div></div>
        <div className="brain-review-note"><ShieldCheck size={14}/><span><strong>{t('memory.reviewRequired')}</strong><small>{t('memory.newCandidate')}</small></span></div>
        <div className="brain-create-options"><label>{t('memory.type')}<select value={kind} onChange={(event) => setKind(event.target.value as BrainMemoryKind)}>{memoryKinds.map((value) => <option key={value} value={value}>{kindLabel(value, t)}</option>)}</select></label><label>{t('memory.scope')}<select value={scope} onChange={(event) => setScope(event.target.value as BrainMemoryScope)}><option value="workspace">{t('agent.workspace')}</option><option value="conversation">{t('memory.currentConversation')}</option></select></label></div>
        <label className="brain-content-label">{t('memory.content')}<textarea value={content} onChange={(event) => setContent(event.target.value)} maxLength={8_000} aria-describedby="brain-content-help" placeholder={t('memory.contentPlaceholder')}/><span id="brain-content-help"><small>{scope === 'workspace' ? t('memory.availableWorkspace') : t('memory.onlyConversation')}</small><small>{content.length.toLocaleString(language === 'en' ? 'en-US' : 'pt-BR')} / 8.000</small></span></label>
        <button className="primary brain-create-action" disabled={saving || !content.trim()}><Plus size={15}/>{saving ? t('settings.saving') : t('memory.addForReview')}</button>
      </form>
      <section className="brain-library" aria-label={t('memory.library')}>
        <div className="brain-library-heading"><div><strong>{t('memory.library')}</strong><small>{items.length ? t('memory.displayedCount', { count: items.length }) : t('memory.persistentKnowledge')}</small></div>{candidateCount > 0 && <span className="brain-pending-count">{t('memory.pendingReview', { count: candidateCount })}</span>}</div>
        <form className="brain-search" role="search" onSubmit={submitSearch}><label><Search size={15}/><input aria-label={t('memory.searchLabel')} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('memory.search')}/>{(query || search) && <button type="button" aria-label={t('memory.clearSearch')} title={t('memory.clearSearch')} onClick={() => { setQuery(''); setSearch('') }}><X size={14}/></button>}</label><button className="brain-search-action">{t('memory.searchButton')}</button><select aria-label={t('memory.filterStatus')} value={filter} onChange={(event) => setFilter(event.target.value as BrainMemoryStatus | 'all')}><option value="all">{t('memory.allStatuses')}</option>{memoryStatuses.map((value) => <option key={value} value={value}>{statusLabel(value, t)}</option>)}</select></form>
        {error && <p className="brain-error" role="alert">{error}</p>}
        {loading && !items.length && <div className="brain-skeletons" role="status" aria-label={t('common.loading')}><span/><span/><span/></div>}
        {!loading && !items.length && <div className="brain-empty"><span><Brain size={25}/></span><strong>{search || filter !== 'all' ? t('memory.noMatches') : t('memory.empty')}</strong><small>{search || filter !== 'all' ? t('memory.adjustSearch') : t('memory.emptyHint')}</small><button onClick={() => setMobileView('create')}><Plus size={14}/>{t('memory.createFirst')}</button></div>}
        <div className={`brain-list ${loading ? 'is-refreshing' : ''}`}>{items.map((memory) => <article className={`brain-card ${memory.status}`} key={memory.id}>
          <div className="brain-card-top"><div className="brain-card-meta"><span>{kindLabel(memory.kind, t)}</span><span>{memory.scope === 'workspace' ? t('agent.workspace') : t('agent.conversation')}</span><span className="brain-source">{memory.sourceType === 'agent' ? t('memory.sourceAgent') : memory.sourceType === 'message' ? t('memory.sourceMessage') : t('memory.sourceUser')}</span></div><span className={`brain-status ${memory.status}`}>{statusLabel(memory.status, t)}</span></div>
          {editing === memory.id ? <div className="brain-edit"><label><span className="sr-only">{t('memory.edit')}</span><textarea value={editContent} onChange={(event) => setEditContent(event.target.value)} maxLength={8_000}/></label><div><button disabled={saving} onClick={() => setEditing(null)}>{t('memory.cancel')}</button><button className="primary" disabled={saving || !editContent.trim()} onClick={() => void update(memory, { content: editContent.trim() }, t('memory.updatedMessage'))}>{t('memory.saveEdit')}</button></div></div> : <p className="brain-card-content">{memory.content}</p>}
          <div className="brain-confidence" aria-label={t('memory.confidenceLabel', { count: memory.confidence })}><span><i style={{ width: `${memory.confidence}%` }}/></span><small>{t('memory.confidence', { count: memory.confidence })}</small></div>
          <div className="brain-audit-summary"><small>{t('memory.createdAt', { date: new Date(memory.createdAt).toLocaleString(language === 'en' ? 'en-US' : 'pt-BR') })} · {t('memory.updatedRelative', { time: relativeTime(memory.updatedAt, language) })} · {t('memory.usedCount', { count: memory.useCount })}</small><button aria-expanded={historyOpen === memory.id} onClick={() => void toggleHistory(memory)}><History size={13}/>{historyOpen === memory.id ? t('memory.hideHistory') : t('memory.viewHistory')}</button></div>
          {historyOpen === memory.id && <div className="brain-history" aria-label={t('memory.history')}>{historyLoading === memory.id ? <small>{t('memory.loadingHistory')}</small> : (history[memory.id] ?? []).map((entry) => <div key={entry.id}><span/><p><strong>{historyLabel(entry.action, t)}</strong><small>{entry.summary} · {new Date(entry.createdAt).toLocaleString(language === 'en' ? 'en-US' : 'pt-BR')}</small></p></div>)}</div>}
          <footer><div className="brain-card-actions">
            {editing !== memory.id && <button disabled={saving} aria-label={t('memory.edit')} title={t('memory.edit')} onClick={() => { setEditing(memory.id); setEditContent(memory.content) }}><Pencil size={14}/></button>}
            {memory.status === 'candidate' && <button disabled={saving} className="success" onClick={() => void update(memory, { status: 'active' }, t('memory.approvedMessage'))}><Check size={14}/>{t('memory.approve')}</button>}
            {memory.status === 'candidate' && <button disabled={saving} onClick={() => void update(memory, { status: 'archived' }, t('memory.disapprovedMessage'))}><X size={14}/>{t('memory.disapprove')}</button>}
            {memory.status === 'active' && <button disabled={saving} onClick={() => void update(memory, { status: 'outdated' }, t('memory.outdatedMessage'))}><RotateCcw size={14}/>{t('memory.markOutdated')}</button>}
            {memory.status === 'outdated' && <button disabled={saving} onClick={() => void update(memory, { status: 'active' }, t('memory.reactivatedMessage'))}><RotateCcw size={14}/>{t('memory.reactivate')}</button>}
            {memory.status === 'archived' && <button disabled={saving} onClick={() => void update(memory, { status: 'active' }, t('memory.restoredMessage'))}><RotateCcw size={14}/>{t('memory.restore')}</button>}
            {(memory.status === 'active' || memory.status === 'outdated') && <button disabled={saving} onClick={() => void update(memory, { status: 'archived' }, t('memory.archivedMessage'))}><Archive size={14}/>{t('memory.archive')}</button>}
            {memory.status === 'archived' && <button disabled={saving} className="danger" onClick={() => void remove(memory)}><Trash2 size={14}/>{confirmDelete === memory.id ? t('memory.confirmDeleteAction') : t('memory.delete')}</button>}
          </div></footer>
        </article>)}</div>
        {loading && items.length > 0 && <p className="brain-loading" role="status">{t('memory.refreshing')}</p>}
        {hasMore && !loading && <button className="brain-more" onClick={() => void load(items.length, true)}>{t('memory.loadOlder')}</button>}
      </section>
    </div>
  </div></div>
}

function kindLabel(kind: BrainMemoryKind, t: (key: string) => string) {
  return ({ fact: t('memory.kindFact'), decision: t('memory.kindDecision'), preference: t('memory.kindPreference'), constraint: t('memory.kindConstraint'), learning: t('memory.kindLearning') } as Record<BrainMemoryKind, string>)[kind]
}

function statusLabel(status: BrainMemoryStatus, t: (key: string) => string) {
  return ({ candidate: t('memory.statusCandidate'), active: t('memory.statusActive'), outdated: t('memory.statusOutdated'), archived: t('memory.statusArchived') } as Record<BrainMemoryStatus, string>)[status]
}

function historyLabel(action: BrainMemoryHistoryEntry['action'], t: (key: string) => string) {
  return ({ created: t('memory.historyCreated'), edited: t('memory.historyEdited'), approved: t('memory.historyApproved'), disapproved: t('memory.historyDisapproved'), 'marked-outdated': t('memory.historyOutdated'), archived: t('memory.historyArchived'), restored: t('memory.historyRestored') } as Record<BrainMemoryHistoryEntry['action'], string>)[action]
}

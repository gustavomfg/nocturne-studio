import { useEffect, type RefObject } from 'react'
import { AlertTriangle, ChevronRight, Code2, FileCode2, Folder, FolderOpen, History, Laptop, Menu, MessageSquarePlus, Search, Settings, Star, Trash2, X } from 'lucide-react'
import type { AppSettings, Conversation, Workspace } from '../../types'
import type { AgentState } from '../../../shared/agentState'
import { relativeTime } from '../../shared/format'
import { useOffCanvasPanel } from '../../shared/useOffCanvasPanel'
import { useI18n } from '../../shared/i18n'

const statusLabelKeys: Record<AgentState, string> = {
  disconnected: 'status.disconnected',
  starting: 'status.starting',
  ready: 'status.ready',
  planning: 'status.planning',
  running: 'status.running',
  'waiting-approval': 'status.waitingApproval',
  cancelling: 'status.cancelling',
  completed: 'status.completed',
  failed: 'status.failed',
}

interface SidebarProps {
  open: boolean; compact: boolean; triggerRef: RefObject<HTMLElement | null>; conversations: Conversation[]; hasConversations: boolean; hasMore: boolean; loadingMore: boolean; activeId: string | null; search: string; searchRef: RefObject<HTMLInputElement | null>; workspace: string; workspaces: Workspace[]; settings: AppSettings; status: AgentState;
  projectIndexActive: boolean
  onClose(): void; onNew(): void; onSearch(value: string): void; onLoadMore(): void; onConversation(id: string): void; onDelete(id: string): void; onProjectIndex(): void; onWorkspace(): void; onSavedWorkspace(path: string): void; onFavorite(item: Workspace): void; onSettings(): void
}

export function Sidebar({ open, compact, triggerRef, conversations, hasConversations, hasMore, loadingMore, activeId, search, searchRef, workspace, workspaces, status, projectIndexActive, onClose, onNew, onSearch, onLoadMore, onConversation, onDelete, onProjectIndex, onWorkspace, onSavedWorkspace, onFavorite, onSettings }: SidebarProps) {
  const { t, language } = useI18n()
  const sidebarRef = useOffCanvasPanel<HTMLElement>({ open, modal: compact, onClose, triggerRef })
  const newShortcut = navigator.platform.toLowerCase().includes('mac') ? '⌘ N' : 'Ctrl N'
  useEffect(() => { if (sidebarRef.current) sidebarRef.current.inert = !open }, [open, sidebarRef])
  return <aside id="workspace-sidebar" ref={sidebarRef} className={`sidebar ${open ? 'open' : 'collapsed'}`} aria-hidden={!open} role={compact && open ? 'dialog' : undefined} aria-modal={compact && open ? true : undefined} aria-label={compact && open ? t('nav.workspace') : undefined} tabIndex={-1}>
    <div className="brand"><div className="brand-mark"><img src="./nocturne.svg" alt=""/></div><span>Nocturne <b>Studio</b></span><button className="icon-button sidebar-toggle" aria-label={t('nav.collapseSidebar')} title={t('nav.collapseSidebar')} onClick={onClose}><Menu size={17}/></button></div>
    <button className="new-chat" onClick={onNew}><MessageSquarePlus size={17}/><span>{t('nav.newConversation')}</span><kbd>{newShortcut}</kbd></button>
    <label className="search-box"><Search size={15}/><span className="sr-only">{t('nav.searchConversations')}</span><input ref={searchRef} value={search} onChange={(event) => onSearch(event.target.value)} placeholder={t('nav.searchConversations')} aria-label={t('nav.searchConversations')}/>{search && <button type="button" aria-label={t('nav.clearSearch')} title={t('nav.clearSearch')} onClick={() => onSearch('')}><X size={13}/></button>}</label>
    <nav className="sidebar-workspace-nav" aria-label={t('nav.workspaceTools')}>
      <button type="button" className={`sidebar-tool ${projectIndexActive ? 'active' : ''}`} aria-current={projectIndexActive ? 'page' : undefined} onClick={onProjectIndex}><FileCode2 size={16}/><span>{t('projectIndex.title')}</span></button>
    </nav>
    <div className="section-label"><span>{t('nav.recent')}</span><History size={13}/></div>
    <nav className="conversation-list">
      {conversations.map((conversation) => <div key={conversation.id} className={`conversation-item ${conversation.id === activeId ? 'active' : ''}`}>
        <button className="conversation-open" onClick={() => onConversation(conversation.id)} aria-current={conversation.id === activeId ? 'page' : undefined}><span className="conversation-icon"><Code2 size={15}/></span><span className="conversation-copy"><strong>{conversation.title}</strong><small>{relativeTime(conversation.updatedAt, language)}</small></span></button>
        <button className="delete-button" aria-label={`${t('common.deleteConversation')} ${conversation.title}`} title={t('common.deleteConversation')} onClick={() => onDelete(conversation.id)}><Trash2 size={13}/></button>
      </div>)}
      {!conversations.length && <div className="empty-list" role="status"><strong>{hasConversations ? t('nav.noResults') : t('nav.noConversations')}</strong><small>{hasConversations ? t('nav.adjustSearch') : t('nav.createConversation')}</small>{search && <button type="button" onClick={() => onSearch('')}>{t('nav.clearSearch')}</button>}</div>}
      {hasMore && <button className="collection-load-more" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? t('common.loading') : t('nav.loadOlderConversations')}</button>}
    </nav>
    <div className="sidebar-footer">
      {workspaces.slice(0, 4).map((item) => {
        const unavailable = item.availability !== 'available'
        const availabilityMessage = item.availability === 'missing'
          ? t('nav.workspaceMissing')
          : item.availability === 'permission-denied'
            ? t('nav.workspacePermissionDenied')
            : item.availability === 'invalid'
              ? t('nav.workspaceInvalid')
              : item.availabilityMessage
        return <div key={item.path} className={`workspace-mini ${workspace === item.path ? 'active' : ''} ${unavailable ? 'unavailable' : ''}`}>
          <button className="workspace-open" onClick={() => onSavedWorkspace(item.path)} title={availabilityMessage}>
            {unavailable ? <AlertTriangle size={13}/> : <Folder size={13}/>}
            <span className="workspace-mini-copy"><span>{item.name}</span>{unavailable && <small>{availabilityMessage}</small>}</span>
          </button>
          <button className="workspace-favorite" aria-label={item.favorite ? `${t('nav.removeFavorite')} ${item.name}` : `${t('nav.favorite')} ${item.name}`} aria-pressed={item.favorite} title={item.favorite ? t('nav.removeFavorite') : t('nav.favorite')} onClick={() => onFavorite(item)}><Star size={12} fill={item.favorite ? 'currentColor' : 'none'}/></button>
        </div>
      })}
      <button className="workspace-card" onClick={onWorkspace}><span className="workspace-icon"><FolderOpen size={17}/></span><span><small>{t('nav.workspaceLabel')}</small><strong>{workspace ? workspace.split(/[/\\]/).pop() : t('nav.selectProject')}</strong></span><ChevronRight size={15}/></button>
      <div className="profile"><div className="avatar"><Laptop size={15}/></div><span><strong>{t('brand.localEnvironment')}</strong></span><span className={`status-dot ${status}`} role="status" aria-label={statusLabelKeys[status] ? t(statusLabelKeys[status]) : status}/><button className="settings-button" aria-label={t('nav.openSettings')} title={t('nav.openSettings')} onClick={onSettings}><Settings size={14}/></button></div>
    </div>
  </aside>
}

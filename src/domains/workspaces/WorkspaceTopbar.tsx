import type { RefObject } from 'react'
import { AlertTriangle, Brain, Check, ChevronRight, Code2, Folder, GitBranch, HelpCircle, LoaderCircle, Menu, PanelRight, Settings, Terminal, X } from 'lucide-react'
import type { GitInfo } from '../../types'
import { useI18n } from '../../shared/i18n'

interface WorkspaceTopbarProps {
  title: string
  pathLabel: string
  gitInfo: GitInfo | null
  status: string
  sidebarOpen: boolean
  inspectorOpen: boolean
  compact: boolean
  hasMemory: boolean
  sidebarTriggerRef: RefObject<HTMLButtonElement | null>
  inspectorTriggerRef: RefObject<HTMLButtonElement | null>
  onOpenSidebar(): void
  onSelectWorkspace(): void
  onOpenTool(tool: 'editor' | 'terminal'): void
  onMemory(): void
  onSettings(): void
  onHelp(): void
  onToggleInspector(): void
}

const statusMeta = {
  disconnected: { key: 'status.disconnected', symbol: 'unavailable' as const },
  starting: { key: 'status.starting', symbol: 'busy' as const },
  ready: { key: 'status.ready', symbol: 'ready' as const },
  planning: { key: 'status.planning', symbol: 'busy' as const },
  running: { key: 'status.running', symbol: 'busy' as const },
  'waiting-approval': { key: 'status.waitingApproval', symbol: 'attention' as const },
  cancelling: { key: 'status.cancelling', symbol: 'busy' as const },
  completed: { key: 'status.completed', symbol: 'ready' as const },
  failed: { key: 'status.failed', symbol: 'unavailable' as const },
}

export function WorkspaceTopbar({ title, pathLabel, gitInfo, status, sidebarOpen, inspectorOpen, compact, hasMemory, sidebarTriggerRef, inspectorTriggerRef, onOpenSidebar, onSelectWorkspace, onOpenTool, onMemory, onSettings, onHelp, onToggleInspector }: WorkspaceTopbarProps) {
  const { t } = useI18n()
  const meta = statusMeta[status as keyof typeof statusMeta] ?? { key: '', symbol: 'unavailable' as const }
  const statusLabel = meta.key ? t(meta.key) : status
  const SymbolIcon = meta.symbol === 'ready' ? Check : meta.symbol === 'attention' ? AlertTriangle : meta.symbol === 'busy' ? LoaderCircle : X
  return <header className="topbar">
    {!sidebarOpen && <button ref={sidebarTriggerRef} className="icon-button" aria-label={t('nav.openSidebar')} title={t('nav.openSidebar')} aria-controls="workspace-sidebar" aria-expanded={sidebarOpen} onClick={onOpenSidebar}><Menu size={18}/></button>}
    <div className="title-block"><h1 title={title}>{title}</h1>{pathLabel && <button className="path-pill" title={pathLabel} onClick={onSelectWorkspace}><Folder size={13}/><span>{pathLabel.split(/[/\\]/).pop()}</span><ChevronRight size={12}/></button>}</div>
    <div className="top-actions">
      {gitInfo && <span className="branch-pill top-action-branch"><GitBranch size={12}/>{gitInfo.branch}</span>}
      {pathLabel && <><button className="icon-button top-action-workspace" aria-label={t('topbar.openWebstorm')} title={t('topbar.openWebstorm')} onClick={() => onOpenTool('editor')}><Code2 size={16}/></button><button className="icon-button top-action-workspace" aria-label={t('topbar.openTerminal')} title={t('topbar.openTerminal')} onClick={() => onOpenTool('terminal')}><Terminal size={16}/></button></>}
      <span className={`connection top-action-essential ${status}`} role="status" aria-label={statusLabel} title={statusLabel}><span/><i className={`connection-symbol ${meta.symbol}`} data-symbol={meta.symbol} aria-hidden="true"><SymbolIcon size={meta.symbol === 'ready' ? 16 : meta.symbol === 'attention' ? 15 : 16}/></i>{statusLabel}</span>
      <button className={`icon-button top-action-essential ${hasMemory ? 'has-memory' : ''}`} aria-label={t('topbar.workspaceMemory')} onClick={onMemory} title={t('topbar.workspaceMemory')}><Brain size={17}/></button>
      <button className="icon-button top-action-secondary" aria-label={t('nav.openSettings')} title={t('nav.openSettings')} onClick={onSettings}><Settings size={17}/></button>
      <button className="icon-button top-action-help" aria-label={t('topbar.openHelp')} title={`${t('topbar.openHelp')} (?)`} onClick={onHelp}><HelpCircle size={17}/></button>
      {(!compact || !inspectorOpen) && <button ref={inspectorTriggerRef} className={`icon-button top-action-essential ${inspectorOpen ? 'selected' : ''}`} aria-label={inspectorOpen ? t('topbar.hideAgent') : t('topbar.showAgent')} title={inspectorOpen ? t('topbar.hideAgent') : t('topbar.showAgent')} aria-controls="agent-inspector" aria-expanded={inspectorOpen} onClick={onToggleInspector}><PanelRight size={18}/></button>}
    </div>
  </header>
}

import { lazy, Suspense, useCallback, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { X } from 'lucide-react'
import { selectPendingApprovalCount, useAppStore } from './store'
import type { Conversation, Workspace } from './types'
import { Sidebar } from './domains/workspaces/Sidebar'
import { WorkspaceTopbar } from './domains/workspaces/WorkspaceTopbar'
import { Composer } from './domains/chat/Composer'
import { ChatViewport } from './domains/chat/ChatViewport'
import { isBusy } from './shared/format'
import { useAgentRunController } from './domains/agent/useAgentRunController'
import { useConfirmDialog } from './shared/ConfirmDialog'
import { useResponsivePanels } from './shared/useResponsivePanels'
import { AppOverlays } from './domains/settings/AppOverlays'
import { usePagedCollections } from './domains/collections/usePagedCollections'
import { useWorkspaceSession } from './domains/workspaces/useWorkspaceSession'
import { useConversationSession } from './domains/chat/useConversationSession'
import { useConversationActions } from './domains/chat/useConversationActions'
import { useChatViewport } from './domains/chat/useChatViewport'
import { useSettingsController } from './domains/settings/useSettingsController'
import { useWorkspaceMemory } from './domains/memory/useWorkspaceMemory'
import { useArtifactActions } from './domains/artifacts/useArtifactActions'
import { useGitSession } from './domains/git/useGitSession'
import { useSuggestionActions } from './domains/suggestions/useSuggestionActions'
import { useI18n } from './shared/i18n'
import { useRendererRenderCounter } from './shared/rendererDiagnostics'
import { useRendererPerformance } from './shared/useRendererPerformance'
import { useAppShortcuts } from './shared/useAppShortcuts'
import { useAppBootstrap } from './domains/app/useAppBootstrap'
import { useAppNotice } from './domains/app/useAppNotice'
import { useAppTheme } from './domains/app/useAppTheme'
import { useSettingsDialogPreload } from './domains/app/useSettingsDialogPreload'
import { useProjectIndexSession } from './domains/code-intelligence/useProjectIndexSession'
import './styles/components.css'
import './domains/settings/settings.css'
import './domains/agent/agent.css'
import './domains/memory/memory.css'
import './styles/product-constraints.css'
import './domains/code-intelligence/project-index.css'

const AgentPanel = lazy(() => import('./domains/agent/AgentPanel').then((module) => ({ default: module.AgentPanel })))
const BrainMemoryDialog = lazy(() => import('./domains/memory/BrainMemoryDialog').then((module) => ({ default: module.BrainMemoryDialog })))

type OpenConversation = (id: string, conversationList?: Conversation[], workspaceList?: Workspace[]) => Promise<void>

function App() {
  useRendererRenderCounter('app')
  const { t } = useI18n()
  const store = useAppStore(useShallow((state) => ({
    conversations: state.conversations, activeId: state.activeId, messages: state.messages, status: state.status, finalizing: state.finalizing, error: state.error,
    setConversations: state.setConversations, setActive: state.setActive, setMessages: state.setMessages, addMessage: state.addMessage, setStatus: state.setStatus, setFinalizing: state.setFinalizing,
    clearRun: state.clearRun, setDiff: state.setDiff, upsertActivity: state.upsertActivity, addApproval: state.addApproval, resolveApproval: state.resolveApproval, setError: state.setError,
    setFiles: state.setFiles, setArtifacts: state.setArtifacts, setSuggestions: state.setSuggestions, setPlan: state.setPlan,
  })))
  const pendingApprovalCount = useAppStore(selectPendingApprovalCount)
  const confirmation = useConfirmDialog()
  const { confirm } = confirmation
  const [search, setSearch] = useState('')
  const { compact: compactLayout, inspectorOpen: rightOpen, sidebarOpen, setInspectorVisibility, setSidebarVisibility } = useResponsivePanels()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [brainOpen, setBrainOpen] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(() => localStorage.getItem('nocturne.onboarding.completed') !== 'true')
  const [newContent, setNewContent] = useState(false)
  const { notice, notify, dismissNotice } = useAppNotice()
  const endRef = useRef<HTMLDivElement>(null)
  const chatScrollRef = useRef<HTMLElement>(null)
  const stickToBottomRef = useRef(true)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const sidebarTriggerRef = useRef<HTMLButtonElement>(null)
  const inspectorTriggerRef = useRef<HTMLButtonElement>(null)
  const { recordStartup, recordConversationLoaded } = useRendererPerformance(store.status)
  const active = store.conversations.find((item) => item.id === store.activeId)
  const interactionLocked = useCallback(() => {
    const state = useAppStore.getState()
    return isBusy(state.status) || state.finalizing
  }, [])
  const settingsController = useSettingsController({ onClose: () => setSettingsOpen(false), onNotify: notify })
  const { settings, initializeSettings, saveSettings, saveCodexModel } = settingsController
  const memoryController = useWorkspaceMemory({ onClose: () => setMemoryOpen(false), onNotify: notify })
  const { memory, setMemory, refreshMemory, loadMemory, clearMemory, saveMemory } = memoryController
  const collections = usePagedCollections(store.setError)
  const { gitInfo, refreshGit, clearGit } = useGitSession()
  const artifactActions = useArtifactActions({ confirm: confirmation.confirm, onError: store.setError, onRefreshArtifacts: collections.refreshArtifacts })
  const { preview, resetPreview, showFilePreview, showArtifact, deleteArtifact, refreshArtifacts } = artifactActions
  const clearMemoryAndGit = useCallback(() => {
    clearMemory()
    clearGit()
  }, [clearGit, clearMemory])
  const refresh = collections.refreshConversations
  const openConversationRef = useRef<OpenConversation>(() => Promise.resolve())
  const openConversation = useCallback<OpenConversation>((id, conversationList, workspaceList) => openConversationRef.current(id, conversationList, workspaceList), [])
  const {
    workspace,
    workspaces,
    workspaceAuthorized,
    initializeWorkspaces,
    setWorkspaceForSession,
    selectWorkspace,
    chooseSavedWorkspace,
    openWorkspaceTool,
    favoriteWorkspace,
  } = useWorkspaceSession({
    conversations: store.conversations,
    activeConversation: active,
    isInteractionLocked: interactionLocked,
    onError: store.setError,
    onOpenConversation: openConversation,
    onClearConversation: clearConversationSession,
    onRefreshGit: refreshGit,
    onRefreshMemory: refreshMemory,
    onNotify: notify,
  })
  const projectIndex = useProjectIndexSession({ workspace, authorized: workspaceAuthorized, onError: store.setError })
  const filtered = store.conversations.filter((item) => item.title.toLowerCase().includes(search.toLowerCase()) && (!workspace || item.workspace === workspace))
  const conversationSession = useConversationSession({
    conversations: store.conversations,
    availableWorkspaces: workspaces,
    isInteractionLocked: interactionLocked,
    confirm: confirmation.confirm,
    onError: store.setError,
    onSetWorkspace: setWorkspaceForSession,
    onInitializeWorkspaces: initializeWorkspaces,
    onRefreshConversations: refresh,
    onLoadCollections: collections.loadConversationCollections,
    onResetPreview: resetPreview,
    onClearMemoryAndGit: clearMemoryAndGit,
    onLoadMemory: loadMemory,
    onSetMemory: setMemory,
    onRefreshGit: refreshGit,
    onConversationLoaded: recordConversationLoaded,
    onNewContent: setNewContent,
    chatScrollRef,
    stickToBottomRef,
  })
  openConversationRef.current = conversationSession.openConversation
  const { historyHasMore, historyHasNewer, historyLoading, loadOlderMessages, loadLatestMessages, resetHistory } = conversationSession
  const { createConversation, removeConversation } = useConversationActions({
    workspace,
    activeConversation: active,
    isInteractionLocked: interactionLocked,
    confirm,
    onRefresh: refresh,
    onSetWorkspace: setWorkspaceForSession,
    onResetHistory: resetHistory,
    onResetPreview: resetPreview,
  })
  const { handleChatScroll, jumpToLatest } = useChatViewport({
    messages: store.messages,
    historyHasNewer,
    loadLatestMessages,
    onNewContent: setNewContent,
    chatScrollRef,
    stickToBottomRef,
  })
  const agentController = useAgentRunController({
    hasNewerMessages: historyHasNewer,
    composerRef,
    isInteractionLocked: interactionLocked,
    onCreateConversation: createConversation,
    onLoadLatestMessages: loadLatestMessages,
    onRefreshConversations: refresh,
    onRefreshCollections: collections.loadConversationCollections,
    onRefreshGit: refreshGit,
  })
  const { prompt, agentMode, attachments, retryAvailableForActiveConversation, setPrompt, setAgentMode, removeAttachment, submitPrompt, send, retryLastAttempt, preparePrompt, attachFiles, cancelRun, decide, markSuggestionApplication } = agentController
  const { updateSuggestion, applySuggestion } = useSuggestionActions({
    activeConversationId: store.activeId,
    isInteractionLocked: interactionLocked,
    confirm: confirmation.confirm,
    refreshSuggestions: collections.refreshSuggestions,
    onError: store.setError,
    onSetPlan: store.setPlan,
    onMarkApplication: markSuggestionApplication,
    onSubmitPrompt: submitPrompt,
  })
  useAppShortcuts({
    isInteractionLocked: interactionLocked,
    onCancel: cancelRun,
    onCreateConversation: createConversation,
    onSelectWorkspace: selectWorkspace,
    searchRef,
    composerRef,
    onHelp: () => setHelpOpen(true),
  })

  useAppBootstrap({
    onSetConversations: store.setConversations,
    onInitializeConversationHasMore: collections.initializeConversationHasMore,
    onInitializeWorkspaces: initializeWorkspaces,
    onInitializeSettings: initializeSettings,
    onOpenConversation: openConversation,
    onRecordStartup: recordStartup,
    onError: store.setError,
  })

  useAppTheme(settings.theme)
  useSettingsDialogPreload()
  function clearConversationSession() {
    store.setActive(null); store.setMessages([]); store.clearRun(); resetHistory(); clearGit()
  }

  const title = active?.title ?? t('common.newConversation')
  const pathLabel = active?.workspace ?? workspace

  return <div className="app-shell">
    {compactLayout && sidebarOpen && <button tabIndex={-1} className="panel-backdrop sidebar-backdrop" aria-label={t('nav.closeSidebar')} onClick={() => setSidebarVisibility(false)}/>}
    <Sidebar open={sidebarOpen} compact={compactLayout} triggerRef={sidebarTriggerRef} conversations={filtered} hasConversations={store.conversations.length > 0} hasMore={collections.conversationHasMore} loadingMore={collections.loading === 'conversations'} activeId={store.activeId} search={search} searchRef={searchRef} workspace={workspace} workspaces={workspaces} settings={settings} status={store.status} onClose={() => setSidebarVisibility(false)} onNew={() => void createConversation().finally(() => { if (compactLayout) setSidebarVisibility(false) })} onSearch={setSearch} onLoadMore={() => void collections.loadMoreConversations()} onConversation={(id) => void openConversation(id).finally(() => { if (compactLayout) setSidebarVisibility(false) })} onDelete={(id) => void removeConversation(id)} onWorkspace={() => void selectWorkspace().finally(() => { if (compactLayout) setSidebarVisibility(false) })} onSavedWorkspace={(path) => void chooseSavedWorkspace(path).finally(() => { if (compactLayout) setSidebarVisibility(false) })} onFavorite={(item) => void favoriteWorkspace(item)} onSettings={() => { if (compactLayout) setSidebarVisibility(false); setSettingsOpen(true) }}/>

    <main className="main-panel">
      <WorkspaceTopbar title={title} pathLabel={pathLabel} gitInfo={gitInfo} status={store.status} projectIndexStatus={projectIndex.status} sidebarOpen={sidebarOpen} inspectorOpen={rightOpen} compact={compactLayout} hasMemory={Boolean(memory.content)} sidebarTriggerRef={sidebarTriggerRef} inspectorTriggerRef={inspectorTriggerRef} onOpenSidebar={() => setSidebarVisibility(true)} onSelectWorkspace={() => void selectWorkspace()} onOpenTool={(tool) => void openWorkspaceTool(tool)} onMemory={() => store.activeId ? setMemoryOpen(true) : store.setError(t('common.noWorkspace'))} onSettings={() => setSettingsOpen(true)} onHelp={() => setHelpOpen(true)} onToggleInspector={() => setInspectorVisibility(!rightOpen)}/>

      <ChatViewport active={Boolean(store.activeId)} messages={store.messages} error={store.error} historyHasMore={historyHasMore} historyHasNewer={historyHasNewer} historyLoading={historyLoading} newContent={newContent} chatScrollRef={chatScrollRef} endRef={endRef} stickToBottomRef={stickToBottomRef} onNew={() => void createConversation()} onWorkspace={() => void selectWorkspace()} onPrompt={preparePrompt} onLoadOlder={() => void loadOlderMessages()} onLoadLatest={() => void loadLatestMessages()} onScroll={handleChatScroll} onNewContent={setNewContent} onDismissError={() => store.setError(null)} onRetryError={retryAvailableForActiveConversation ? retryLastAttempt : undefined} onJumpLatest={jumpToLatest}/>

      <Composer agentMode={agentMode} attachments={attachments} prompt={prompt} status={store.status} finalizing={store.finalizing} active={Boolean(store.activeId)} pendingApprovals={pendingApprovalCount} composerRef={composerRef} onMode={setAgentMode} onPrompt={setPrompt} onRemoveAttachment={removeAttachment} onAttach={attachFiles} onCancel={cancelRun} onSubmit={send} onQuick={preparePrompt}/>
    </main>
    {compactLayout && rightOpen && <button tabIndex={-1} className="panel-backdrop inspector-backdrop" aria-label={t('topbar.closeAgent')} onClick={() => setInspectorVisibility(false)}/>}

    <Suspense fallback={null}><AgentPanel open={rightOpen} compact={compactLayout} triggerRef={inspectorTriggerRef} gitInfo={gitInfo} artifactsHaveMore={collections.artifactHasMore} suggestionsHaveMore={collections.suggestionHasMore} loadingCollection={collections.loading} onClose={() => setInspectorVisibility(false)} onDecide={decide} onError={store.setError} onNotify={notify} onGitRefresh={refreshGit} onArtifactsRefresh={refreshArtifacts} onLoadMoreArtifacts={() => void collections.loadMoreArtifacts()} onLoadMoreSuggestions={() => void collections.loadMoreSuggestions()} onPreview={showFilePreview} onArtifact={showArtifact} onDeleteArtifact={deleteArtifact} onSuggestionStatus={updateSuggestion} onSuggestionApply={applySuggestion} onPlanChange={(plan) => store.setPlan(plan, useAppStore.getState().planExplanation)} onPlanExecute={(plan) => preparePrompt(`${t('quick.executePlan')}\n\n${plan.map((item, index) => `${index + 1}. ${item.step}`).join('\n')}`, 'build')} projectIndex={{ workspace, status: projectIndex.status, summary: projectIndex.summary, stack: projectIndex.stack, symbols: projectIndex.symbols, query: projectIndex.query, loading: projectIndex.loading, onQuery: projectIndex.setQuery, onSearch: () => void projectIndex.searchSymbols(), onStart: () => void projectIndex.start(), onCancel: () => void projectIndex.cancel(), onRetry: () => void projectIndex.retry(), validationRuns: projectIndex.validationRuns, validationLoading: projectIndex.validationLoading, onValidation: (kind) => void projectIndex.runValidation(kind), onValidationCancel: () => void projectIndex.cancelValidation() }}/></Suspense>
    {confirmation.dialog}<AppOverlays settingsOpen={settingsOpen} settings={settings} workspaces={workspaces} memoryOpen={memoryOpen} memory={memory} preview={preview} onboardingOpen={onboardingOpen} helpOpen={helpOpen} activeId={store.activeId} workspace={workspace} onSettingsClose={() => setSettingsOpen(false)} onSaveSettings={saveSettings} onCodexModelChange={saveCodexModel} onNotify={notify} onOpenOnboarding={() => { setSettingsOpen(false); setOnboardingOpen(true) }} onMemoryClose={() => setMemoryOpen(false)} onOpenBrain={() => { setMemoryOpen(false); setBrainOpen(true) }} onSaveMemory={saveMemory} onPreviewClose={resetPreview} onError={store.setError} onWorkspace={async () => { await selectWorkspace() }} onOpenSettings={() => { setOnboardingOpen(false); setSettingsOpen(true) }} onDismissOnboarding={() => { setOnboardingOpen(false); composerRef.current?.focus() }} onCompleteOnboarding={() => { localStorage.setItem('nocturne.onboarding.completed', 'true'); setOnboardingOpen(false); notify(t('common.reloaded')); composerRef.current?.focus() }} onHelpClose={() => setHelpOpen(false)}/><Suspense fallback={null}>{brainOpen && store.activeId && <BrainMemoryDialog conversationId={store.activeId} onClose={() => setBrainOpen(false)} onNotify={notify}/>}</Suspense>{notice && <div className="product-toast" role="status" aria-live="polite"><span>{notice}</span><button aria-label={t('common.close')} onClick={dismissNotice}><X size={14}/></button></div>}
  </div>
}

export default App

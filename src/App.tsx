import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { X } from 'lucide-react'
import { selectPendingApprovalCount, useAppStore } from './store'
import type { Activity, ChangedFile, Conversation, PlanStep, Workspace } from './types'
import { Sidebar } from './domains/workspaces/Sidebar'
import { WorkspaceTopbar } from './domains/workspaces/WorkspaceTopbar'
import { Composer } from './domains/chat/Composer'
import { ChatViewport } from './domains/chat/ChatViewport'
import { errorMessage, isBusy } from './shared/format'
import { useAgentRunController } from './domains/agent/useAgentRunController'
import { useConfirmDialog } from './shared/ConfirmDialog'
import { useResponsivePanels } from './shared/useResponsivePanels'
import { AppOverlays } from './domains/settings/AppOverlays'
import { loadSettingsDialog } from './domains/settings/loadSettingsDialog'
import { usePagedCollections } from './domains/collections/usePagedCollections'
import { useWorkspaceSession } from './domains/workspaces/useWorkspaceSession'
import { useConversationSession } from './domains/chat/useConversationSession'
import { useSettingsController } from './domains/settings/useSettingsController'
import { useWorkspaceMemory } from './domains/memory/useWorkspaceMemory'
import { useArtifactActions } from './domains/artifacts/useArtifactActions'
import { useGitSession } from './domains/git/useGitSession'
import { useSuggestionActions } from './domains/suggestions/useSuggestionActions'
import { useI18n } from './shared/i18n'
import { useRendererRenderCounter } from './shared/rendererDiagnostics'
import { useRendererPerformance } from './shared/useRendererPerformance'
import { useAppShortcuts } from './shared/useAppShortcuts'
import './styles/components.css'
import './domains/settings/settings.css'
import './domains/agent/agent.css'
import './domains/memory/memory.css'
import './styles/product-constraints.css'

const AgentPanel = lazy(() => import('./domains/agent/AgentPanel').then((module) => ({ default: module.AgentPanel })))
const BrainMemoryDialog = lazy(() => import('./domains/memory/BrainMemoryDialog').then((module) => ({ default: module.BrainMemoryDialog })))

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> }
}

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
  const [notice, setNotice] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const chatScrollRef = useRef<HTMLElement>(null)
  const stickToBottomRef = useRef(true)
  const noticeTimerRef = useRef<number | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const sidebarTriggerRef = useRef<HTMLButtonElement>(null)
  const inspectorTriggerRef = useRef<HTMLButtonElement>(null)
  const { recordStartup, recordConversationLoaded } = useRendererPerformance(store.status)
  const active = store.conversations.find((item) => item.id === store.activeId)
  const notify = useCallback((message: string) => {
    setNotice(message)
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 3_200)
  }, [])
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
  const restoreMetadata = useCallback((metadata: string) => {
    try {
      const parsed = JSON.parse(metadata) as { diff?: string; activities?: Activity[]; files?: ChangedFile[]; plan?: PlanStep[]; planExplanation?: string }
      const current = useAppStore.getState()
      if (parsed.diff) current.setDiff(parsed.diff)
      if (parsed.activities) parsed.activities.forEach(current.upsertActivity)
      if (parsed.files) current.setFiles(parsed.files)
      if (parsed.plan) current.setPlan(parsed.plan, parsed.planExplanation)
    } catch { /* metadata from older versions is optional */ }
  }, [])
  const refresh = collections.refreshConversations
  const openConversationRef = useRef<OpenConversation>(() => Promise.resolve())
  const openConversation = useCallback<OpenConversation>((id, conversationList, workspaceList) => openConversationRef.current(id, conversationList, workspaceList), [])
  const {
    workspace,
    workspaces,
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
    onRestoreMetadata: restoreMetadata,
    onConversationLoaded: recordConversationLoaded,
    onNewContent: setNewContent,
    chatScrollRef,
    stickToBottomRef,
  })
  openConversationRef.current = conversationSession.openConversation
  const { historyHasMore, historyHasNewer, historyLoading, loadOlderMessages, loadLatestMessages, resetHistory } = conversationSession
  const handleChatScroll = useCallback(() => {
    const scroller = chatScrollRef.current
    if (!scroller) return
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 96
    stickToBottomRef.current = atBottom
    if (atBottom) setNewContent(false)
  }, [])
  const jumpToLatest = useCallback(() => {
    if (historyHasNewer) {
      void loadLatestMessages()
      return
    }
    const scroller = chatScrollRef.current
    if (!scroller) return
    stickToBottomRef.current = true
    setNewContent(false)
    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }, [historyHasNewer, loadLatestMessages])
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

  useEffect(() => {
    void Promise.all([window.nocturne.conversations.page(), window.nocturne.workspace.list(), window.nocturne.settings.get()]).then(async ([conversationPage, savedWorkspaces, savedSettings]) => {
      const conversations = conversationPage.items
      store.setConversations(conversations); void collections.initializeConversationHasMore(conversationPage.hasMore); initializeWorkspaces(savedWorkspaces); initializeSettings(savedSettings)
      if (conversations[0]) await openConversation(conversations[0].id, conversations, savedWorkspaces)
      recordStartup()
    }).catch((error) => store.setError(error.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const scroller = chatScrollRef.current
    if (!scroller) return
    if (stickToBottomRef.current) {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
      setNewContent(false)
    }
  }, [store.messages])
  useEffect(() => () => { if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current) }, [])
  useEffect(() => {
    const root = document.documentElement
    const nextTheme = settings.theme === 'light' ? 'light' : 'dark'
    const currentTheme = root.dataset.theme || 'dark'
    if (currentTheme === nextTheme) { root.dataset.theme = nextTheme; return }
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const transitionDocument = document as ViewTransitionDocument
    const applyTheme = () => { root.dataset.theme = nextTheme }
    if (!reducedMotion && typeof transitionDocument.startViewTransition === 'function') {
      try {
        const transition = transitionDocument.startViewTransition(applyTheme)
        void transition.finished.catch(() => undefined)
        return
      } catch { /* fallback for engines that expose but cannot start a transition */ }
    }
    applyTheme()
  }, [settings.theme])
  useEffect(() => {
    const preload = () => { void loadSettingsDialog() }
    const idle = window.requestIdleCallback?.(preload, { timeout: 1_500 })
    if (idle === undefined) { const timer = window.setTimeout(preload, 500); return () => window.clearTimeout(timer) }
    return () => window.cancelIdleCallback?.(idle)
  }, [])
  async function createConversation() {
    if (interactionLocked()) { store.setError(t('common.waitBeforeCreate')); return }
    let selected = workspace || active?.workspace
    if (!selected) selected = await window.nocturne.workspace.select() ?? ''
    if (!selected) return
    const conversation = await window.nocturne.conversations.create(selected)
    await refresh(); store.setActive(conversation.id); store.setMessages([]); store.clearRun(); resetHistory(); setWorkspaceForSession(selected)
  }

  function clearConversationSession() {
    store.setActive(null); store.setMessages([]); store.clearRun(); resetHistory(); clearGit()
  }

  const removeConversation = useCallback(async (id: string) => {
    if (interactionLocked()) { useAppStore.getState().setError(t('common.waitBeforeDelete')); return }
    const current = useAppStore.getState()
    const conversation = current.conversations.find((item) => item.id === id)
    if (!await confirm({ title: t('common.deleteConversationConfirm'), description: `"${conversation?.title || t('common.thisConversation')}" ${t('common.conversationRemoved')}`, confirmLabel: t('common.deleteConversation'), danger: true })) return
    try {
      await window.nocturne.conversations.delete(id)
      const next = useAppStore.getState()
      if (next.activeId === id) { next.setActive(null); next.setMessages([]); next.setArtifacts([]); resetHistory(); resetPreview() }
      await refresh()
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    }
  }, [confirm, interactionLocked, refresh, resetHistory, resetPreview, t])

  const title = active?.title ?? t('common.newConversation')
  const pathLabel = active?.workspace ?? workspace

  return <div className="app-shell">
    {compactLayout && sidebarOpen && <button tabIndex={-1} className="panel-backdrop sidebar-backdrop" aria-label={t('nav.closeSidebar')} onClick={() => setSidebarVisibility(false)}/>}
    <Sidebar open={sidebarOpen} compact={compactLayout} triggerRef={sidebarTriggerRef} conversations={filtered} hasConversations={store.conversations.length > 0} hasMore={collections.conversationHasMore} loadingMore={collections.loading === 'conversations'} activeId={store.activeId} search={search} searchRef={searchRef} workspace={workspace} workspaces={workspaces} settings={settings} status={store.status} onClose={() => setSidebarVisibility(false)} onNew={() => void createConversation().finally(() => { if (compactLayout) setSidebarVisibility(false) })} onSearch={setSearch} onLoadMore={() => void collections.loadMoreConversations()} onConversation={(id) => void openConversation(id).finally(() => { if (compactLayout) setSidebarVisibility(false) })} onDelete={(id) => void removeConversation(id)} onWorkspace={() => void selectWorkspace().finally(() => { if (compactLayout) setSidebarVisibility(false) })} onSavedWorkspace={(path) => void chooseSavedWorkspace(path).finally(() => { if (compactLayout) setSidebarVisibility(false) })} onFavorite={(item) => void favoriteWorkspace(item)} onSettings={() => { if (compactLayout) setSidebarVisibility(false); setSettingsOpen(true) }}/>

    <main className="main-panel">
      <WorkspaceTopbar title={title} pathLabel={pathLabel} gitInfo={gitInfo} status={store.status} sidebarOpen={sidebarOpen} inspectorOpen={rightOpen} compact={compactLayout} hasMemory={Boolean(memory.content)} sidebarTriggerRef={sidebarTriggerRef} inspectorTriggerRef={inspectorTriggerRef} onOpenSidebar={() => setSidebarVisibility(true)} onSelectWorkspace={() => void selectWorkspace()} onOpenTool={(tool) => void openWorkspaceTool(tool)} onMemory={() => store.activeId ? setMemoryOpen(true) : store.setError(t('common.noWorkspace'))} onSettings={() => setSettingsOpen(true)} onHelp={() => setHelpOpen(true)} onToggleInspector={() => setInspectorVisibility(!rightOpen)}/>

      <ChatViewport active={Boolean(store.activeId)} messages={store.messages} error={store.error} historyHasMore={historyHasMore} historyHasNewer={historyHasNewer} historyLoading={historyLoading} newContent={newContent} chatScrollRef={chatScrollRef} endRef={endRef} stickToBottomRef={stickToBottomRef} onNew={() => void createConversation()} onWorkspace={() => void selectWorkspace()} onPrompt={preparePrompt} onLoadOlder={() => void loadOlderMessages()} onLoadLatest={() => void loadLatestMessages()} onScroll={handleChatScroll} onNewContent={setNewContent} onDismissError={() => store.setError(null)} onRetryError={retryAvailableForActiveConversation ? retryLastAttempt : undefined} onJumpLatest={jumpToLatest}/>

      <Composer agentMode={agentMode} attachments={attachments} prompt={prompt} status={store.status} finalizing={store.finalizing} active={Boolean(store.activeId)} pendingApprovals={pendingApprovalCount} composerRef={composerRef} onMode={setAgentMode} onPrompt={setPrompt} onRemoveAttachment={removeAttachment} onAttach={attachFiles} onCancel={cancelRun} onSubmit={send} onQuick={preparePrompt}/>
    </main>
    {compactLayout && rightOpen && <button tabIndex={-1} className="panel-backdrop inspector-backdrop" aria-label={t('topbar.closeAgent')} onClick={() => setInspectorVisibility(false)}/>}

    <Suspense fallback={null}><AgentPanel open={rightOpen} compact={compactLayout} triggerRef={inspectorTriggerRef} gitInfo={gitInfo} artifactsHaveMore={collections.artifactHasMore} suggestionsHaveMore={collections.suggestionHasMore} loadingCollection={collections.loading} onClose={() => setInspectorVisibility(false)} onDecide={decide} onError={store.setError} onNotify={notify} onGitRefresh={refreshGit} onArtifactsRefresh={refreshArtifacts} onLoadMoreArtifacts={() => void collections.loadMoreArtifacts()} onLoadMoreSuggestions={() => void collections.loadMoreSuggestions()} onPreview={showFilePreview} onArtifact={showArtifact} onDeleteArtifact={deleteArtifact} onSuggestionStatus={updateSuggestion} onSuggestionApply={applySuggestion} onPlanChange={(plan) => store.setPlan(plan, useAppStore.getState().planExplanation)} onPlanExecute={(plan) => preparePrompt(`${t('quick.executePlan')}\n\n${plan.map((item, index) => `${index + 1}. ${item.step}`).join('\n')}`, 'build')}/></Suspense>
    {confirmation.dialog}<AppOverlays settingsOpen={settingsOpen} settings={settings} workspaces={workspaces} memoryOpen={memoryOpen} memory={memory} preview={preview} onboardingOpen={onboardingOpen} helpOpen={helpOpen} activeId={store.activeId} workspace={workspace} onSettingsClose={() => setSettingsOpen(false)} onSaveSettings={saveSettings} onCodexModelChange={saveCodexModel} onNotify={notify} onOpenOnboarding={() => { setSettingsOpen(false); setOnboardingOpen(true) }} onMemoryClose={() => setMemoryOpen(false)} onOpenBrain={() => { setMemoryOpen(false); setBrainOpen(true) }} onSaveMemory={saveMemory} onPreviewClose={resetPreview} onError={store.setError} onWorkspace={async () => { await selectWorkspace() }} onOpenSettings={() => { setOnboardingOpen(false); setSettingsOpen(true) }} onDismissOnboarding={() => { setOnboardingOpen(false); composerRef.current?.focus() }} onCompleteOnboarding={() => { localStorage.setItem('nocturne.onboarding.completed', 'true'); setOnboardingOpen(false); notify(t('common.reloaded')); composerRef.current?.focus() }} onHelpClose={() => setHelpOpen(false)}/><Suspense fallback={null}>{brainOpen && store.activeId && <BrainMemoryDialog conversationId={store.activeId} onClose={() => setBrainOpen(false)} onNotify={notify}/>}</Suspense>{notice && <div className="product-toast" role="status" aria-live="polite"><span>{notice}</span><button aria-label={t('common.close')} onClick={() => setNotice(null)}><X size={14}/></button></div>}
  </div>
}

export default App

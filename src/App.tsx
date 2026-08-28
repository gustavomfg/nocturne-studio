import { FormEvent, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { X } from 'lucide-react'
import { useAppStore } from './store'
import type { Activity, AgentEvent, AgentMode, AppSettings, Attachment, ChangedFile, FilePreview, GitInfo, PlanStep, Suggestion, SuggestionStatus, Workspace, WorkspaceMemory } from './types'
import { Sidebar } from './domains/workspaces/Sidebar'
import { WorkspaceTopbar } from './domains/workspaces/WorkspaceTopbar'
import { Composer } from './domains/chat/Composer'
import { ChatViewport } from './domains/chat/ChatViewport'
import { errorMessage, isBusy } from './shared/format'
import { RENDERER_LIMITS, UI_TIMING } from '../shared/constants'
import { persistedAssistantMessage, useTurnLifecycle, type ActiveTurnContext } from './domains/agent/useTurnLifecycle'
import { routeAgentEvent } from './domains/agent/routeCodexEvent'
import { useBufferedAgentEvents } from './domains/agent/useBufferedCodexEvents'
import { useConfirmDialog } from './shared/ConfirmDialog'
import { useResponsivePanels } from './shared/useResponsivePanels'
import { AppOverlays } from './domains/settings/AppOverlays'
import { loadSettingsDialog } from './domains/settings/loadSettingsDialog'
import { usePagedCollections } from './domains/collections/usePagedCollections'
import { translate, useI18n } from './shared/i18n'
import './styles/components.css'
import './domains/settings/settings.css'
import './domains/agent/agent.css'
import './domains/memory/memory.css'
import './styles/product-constraints.css'

const now = () => new Date().toISOString()
const fakeId = () => crypto.randomUUID()
const messageBubble = (entry: HTMLElement) => (
  entry.querySelector<HTMLElement>('.user-row, .assistant-row') ?? entry
)
const visibleMessageAnchor = (scroller: HTMLElement) => {
  const top = scroller.getBoundingClientRect().top
  const entries = Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-id]'))
  const element = entries.find((entry) => messageBubble(entry).getBoundingClientRect().bottom >= top)
  return element ? { id: element.dataset.messageId ?? '', top: messageBubble(element).getBoundingClientRect().top } : null
}
const AgentPanel = lazy(() => import('./domains/agent/AgentPanel').then((module) => ({ default: module.AgentPanel })))
const BrainMemoryDialog = lazy(() => import('./domains/memory/BrainMemoryDialog').then((module) => ({ default: module.BrainMemoryDialog })))

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> }
}

function App() {
  const { setLanguage, t } = useI18n()
  const store = useAppStore(useShallow((state) => ({
    conversations: state.conversations, activeId: state.activeId, messages: state.messages, status: state.status, finalizing: state.finalizing, approvals: state.approvals, error: state.error,
    setConversations: state.setConversations, setActive: state.setActive, setMessages: state.setMessages, addMessage: state.addMessage, setStatus: state.setStatus, setFinalizing: state.setFinalizing,
    clearRun: state.clearRun, setDiff: state.setDiff, upsertActivity: state.upsertActivity, addApproval: state.addApproval, resolveApproval: state.resolveApproval, setError: state.setError,
    setFiles: state.setFiles, setArtifacts: state.setArtifacts, setSuggestions: state.setSuggestions, setPlan: state.setPlan,
  })))
  const confirmation = useConfirmDialog()
  const [workspace, setWorkspace] = useState('')
  const [prompt, setPrompt] = useState('')
  const [search, setSearch] = useState('')
  const { compact: compactLayout, inspectorOpen: rightOpen, sidebarOpen, setInspectorVisibility, setSidebarVisibility } = useResponsivePanels()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<AppSettings>({ model: '', sandbox: 'workspace-write', approvalPolicy: 'on-request', diagnosticMode: false, theme: 'dark', language: 'pt-BR' })
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [memory, setMemory] = useState<WorkspaceMemory>({ content: '', rules: '', updatedAt: '' })
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [brainOpen, setBrainOpen] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(() => localStorage.getItem('nocturne.onboarding.completed') !== 'true')
  const [agentMode, setAgentMode] = useState<AgentMode>('review')
  const [newContent, setNewContent] = useState(false)
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [historyHasNewer, setHistoryHasNewer] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [runRetryAvailable, setRunRetryAvailable] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const chatScrollRef = useRef<HTMLElement>(null)
  const stickToBottomRef = useRef(true)
  const noticeTimerRef = useRef<number | null>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const sidebarTriggerRef = useRef<HTMLButtonElement>(null)
  const inspectorTriggerRef = useRef<HTMLButtonElement>(null)
  const { queueStreamDelta, flushStream, appendActivityDetail, addItemActivity, completeItem } = useBufferedAgentEvents()
  const activeTurnRef = useRef<ActiveTurnContext | null>(null)
  const applyingSuggestionRef = useRef<{ id: string; affectedFiles: string[] } | null>(null)
  const lastAttemptRef = useRef<{ conversationId: string; content: string; mode: AgentMode; attachments: Attachment[] } | null>(null)
  const conversationRequestRef = useRef(0)
  const historyOffsetRef = useRef(0)
  const performanceRef = useRef({ startupMs: 0, conversationLoadMs: 0, longTasks: 0, longTaskDurationMs: 0, longestLongTaskMs: 0 })
  const active = store.conversations.find((item) => item.id === store.activeId)
  const filtered = store.conversations.filter((item) => item.title.toLowerCase().includes(search.toLowerCase()) && (!workspace || item.workspace === workspace))
  const workspaceAuthorized = Boolean(workspaces.find((item) => item.path === workspace)?.authorized)
  const finishTurn = useTurnLifecycle({ flushStream, activeTurnRef, refreshGit })
  const collections = usePagedCollections(store.setError)
  const interactionLocked = () => { const state = useAppStore.getState(); return isBusy(state.status) || state.finalizing }
  const reportRendererPerformance = useCallback(() => {
    const state = useAppStore.getState()
    void window.nocturne.diagnostics.rendererStats({
      responseSize: state.streaming.length,
      activities: state.activities.length,
      messages: state.messages.length,
      ...performanceRef.current,
    }).catch(() => undefined)
  }, [])

  const refresh = collections.refreshConversations

  useEffect(() => {
    void Promise.all([window.nocturne.conversations.page(), window.nocturne.workspace.list(), window.nocturne.settings.get()]).then(async ([conversationPage, savedWorkspaces, savedSettings]) => {
      const conversations = conversationPage.items
      const normalized = { model: savedSettings.model || '', sandbox: savedSettings.sandbox || 'workspace-write', approvalPolicy: savedSettings.approvalPolicy === 'untrusted' ? 'untrusted' : 'on-request', diagnosticMode: savedSettings.diagnosticMode === true, theme: savedSettings.theme === 'light' ? 'light' : 'dark', language: savedSettings.language === 'en' ? 'en' : 'pt-BR' } as AppSettings
      store.setConversations(conversations); void collections.initializeConversationHasMore(conversationPage.hasMore); setWorkspaces(savedWorkspaces); setSettings(normalized); setLanguage(normalized.language ?? 'pt-BR')
      if (conversations[0]) await openConversation(conversations[0].id, conversations, savedWorkspaces)
      performanceRef.current.startupMs = performance.now()
      reportRendererPerformance()
    }).catch((error) => store.setError(error.message))
    const offStatus = window.nocturne.ai.onStatus(({ status, conversationId, error }) => {
      if (conversationId && conversationId !== activeTurnRef.current?.conversationId) return
      store.setStatus(status)
      if (status === 'completed' && activeTurnRef.current) store.setFinalizing(true)
      if (error) store.setError(error)
    })
    const offEvent = window.nocturne.ai.onEvent(handleAgentEvent)
    return () => { offStatus(); offEvent() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes.includes('longtask')) return
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries()
      performanceRef.current.longTasks += entries.length
      performanceRef.current.longTaskDurationMs += entries.reduce((total, entry) => total + entry.duration, 0)
      performanceRef.current.longestLongTaskMs = Math.max(
        performanceRef.current.longestLongTaskMs,
        ...entries.map((entry) => entry.duration),
      )
      reportRendererPerformance()
    })
    observer.observe({ entryTypes: ['longtask'] })
    return () => observer.disconnect()
  }, [reportRendererPerformance])
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
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) { if (event.key === 'Escape' && isBusy(useAppStore.getState().status) && !document.querySelector('[aria-modal="true"]')) void cancelRun(); return }
      if (document.querySelector('[aria-modal="true"]')) return
      if (interactionLocked()) return
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); void createConversation() }
      if (event.key.toLowerCase() === 'o') { event.preventDefault(); void selectWorkspace() }
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); searchRef.current?.focus() }
      if (event.key === 'Enter') { event.preventDefault(); composerRef.current?.form?.requestSubmit() }
    }
    window.addEventListener('keydown', shortcuts)
    return () => window.removeEventListener('keydown', shortcuts)
  })
  useEffect(() => {
    if (!isBusy(store.status)) return
    const timer = setInterval(reportRendererPerformance, UI_TIMING.diagnosticsIntervalMs)
    return () => clearInterval(timer)
  }, [reportRendererPerformance, store.status])
  useEffect(() => {
    if (!workspace || !workspaceAuthorized) return
    let refreshTimer: number | null = null
    let refreshContext = false
    const flushExternalChanges = () => {
      refreshTimer = null
      const state = useAppStore.getState()
      const conversation = state.conversations.find((item) => item.id === state.activeId)
      if (!conversation || conversation.workspace !== workspace) return
      void window.nocturne.git.status(conversation.id).then((info) => {
        if (useAppStore.getState().activeId === conversation.id) setGitInfo(info)
      }).catch(() => {
        if (useAppStore.getState().activeId === conversation.id) setGitInfo(null)
      })
      if (refreshContext) {
        refreshContext = false
        void window.nocturne.memory.get(conversation.id).then((next) => {
          if (useAppStore.getState().activeId === conversation.id) setMemory(next)
        }).catch((error) => useAppStore.getState().setError(errorMessage(error)))
      }
    }
    const offChanged = window.nocturne.workspace.onChanged((event) => {
      if (event.workspace !== workspace) return
      if (event.error) {
        useAppStore.getState().setError(event.error)
        return
      }
      refreshContext ||= event.overflow || event.paths.some((changedPath) => /^\.nocturne\/(?:memory\.md|rules\.md|project\.json)$/i.test(changedPath))
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(flushExternalChanges, 300)
    })
    void window.nocturne.workspace.watch(workspace).catch((error) => useAppStore.getState().setError(errorMessage(error)))
    return () => {
      offChanged()
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      void window.nocturne.workspace.watch(null).catch(() => undefined)
    }
  }, [workspace, workspaceAuthorized])

  async function selectWorkspace() {
    if (interactionLocked()) { store.setError(t('common.waitBeforeSwitch')); return }
    const selected = await window.nocturne.workspace.select()
    if (selected) { setWorkspace(selected); setWorkspaces(await window.nocturne.workspace.list()) }
  }

  async function createConversation() {
    if (interactionLocked()) { store.setError(t('common.waitBeforeCreate')); return }
    let selected = workspace || active?.workspace
    if (!selected) selected = await window.nocturne.workspace.select() ?? ''
    if (!selected) return
    const conversation = await window.nocturne.conversations.create(selected)
    await refresh(); store.setActive(conversation.id); store.setMessages([]); store.clearRun(); historyOffsetRef.current = 0; setHistoryHasMore(false); setHistoryHasNewer(false); setWorkspace(selected)
  }

  async function chooseSavedWorkspace(selected: string) {
    if (interactionLocked()) { store.setError(t('common.waitBeforeSwitch')); return }
    setWorkspace(selected)
    const conversation = store.conversations.find((item) => item.workspace === selected)
    if (conversation) await openConversation(conversation.id)
    else { store.setActive(null); store.setMessages([]); store.clearRun(); setHistoryHasNewer(false); setGitInfo(null) }
  }

  async function openConversation(id: string, conversations = store.conversations, availableWorkspaces = workspaces) {
    const loadStartedAt = performance.now()
    if (interactionLocked() && id !== useAppStore.getState().activeId) { store.setError(t('common.waitBeforeConversation')); return }
    const requestId = ++conversationRequestRef.current
    stickToBottomRef.current = true; setNewContent(false)
    store.setActive(id); store.clearRun()
    const page = await window.nocturne.conversations.messagePage(id)
    const messages = page.items
    if (requestId !== conversationRequestRef.current || useAppStore.getState().activeId !== id) return
    store.setMessages(messages); historyOffsetRef.current = messages.length; setHistoryHasMore(page.hasMore); setHistoryHasNewer(false)
    const lastMetadata = [...messages].reverse().find((message) => message.metadata)?.metadata
    if (lastMetadata) restoreMetadata(lastMetadata)
    const conversation = conversations.find((item) => item.id === id)
    if (conversation) setWorkspace(conversation.workspace)
    await collections.loadConversationCollections(id)
    if (requestId !== conversationRequestRef.current || useAppStore.getState().activeId !== id) return
    setPreview(null)
    const workspaceEntry = conversation && availableWorkspaces.find((item) => item.path === conversation.workspace)
    if (conversation && !workspaceEntry?.authorized) {
      setMemory({ content: '', rules: '', updatedAt: '' }); setGitInfo(null)
      const missingWorkspace = workspaceEntry?.availability === 'missing'
      const accepted = await confirmation.confirm({
        title: missingWorkspace ? t('common.movedWorkspace') : t('common.reauthorizeWorkspace'),
        description: `${missingWorkspace ? t('common.movedWorkspaceDescription') : t('common.restoreWorkspaceDescription')}\n\n${conversation.workspace}`,
        confirmLabel: missingWorkspace ? t('common.locateFolder') : t('common.selectFolder'),
      })
      if (requestId !== conversationRequestRef.current || useAppStore.getState().activeId !== id) return
      if (!accepted) { store.setError(t('common.workspaceUnauthorized')); return }
      try {
        const selected = await window.nocturne.workspace.select(conversation.workspace)
        if (!selected) { store.setError(t('common.reauthCancelled')); return }
        const refreshedWorkspaces = await window.nocturne.workspace.list()
        setWorkspaces(refreshedWorkspaces); setWorkspace(selected)
        if (selected !== conversation.workspace) await refresh()
      } catch (error) { store.setError(errorMessage(error)); return }
    }
    const savedMemory = await window.nocturne.memory.get(id)
    if (requestId !== conversationRequestRef.current || useAppStore.getState().activeId !== id) return
    setMemory(savedMemory)
    performanceRef.current.conversationLoadMs = performance.now() - loadStartedAt
    reportRendererPerformance()
    void refreshGit(id)
  }

  async function loadOlderMessages() {
    const conversationId = useAppStore.getState().activeId
    if (!conversationId || historyLoading || !historyHasMore) return
    const scroller = chatScrollRef.current
    const previousHeight = scroller?.scrollHeight ?? 0
    const anchor = scroller ? visibleMessageAnchor(scroller) : null
    stickToBottomRef.current = false
    setHistoryLoading(true)
    try {
      const page = await window.nocturne.conversations.messagePage(conversationId, historyOffsetRef.current)
      if (useAppStore.getState().activeId !== conversationId) return
      const current = useAppStore.getState().messages
      const known = new Set(current.map((message) => message.id))
      const older = page.items.filter((message) => !known.has(message.id))
      const combined = [...older, ...current]
      const bounded = combined.length > RENDERER_LIMITS.chatMessages
        ? combined.slice(0, RENDERER_LIMITS.chatMessages)
        : combined
      store.setMessages(bounded)
      historyOffsetRef.current += page.items.length
      setHistoryHasMore(page.hasMore)
      setHistoryHasNewer((currentValue) => currentValue || bounded.length < combined.length)
      window.requestAnimationFrame(() => {
        if (!scroller) return
        const anchored = anchor && Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-id]'))
          .find((entry) => entry.dataset.messageId === anchor.id)
        scroller.scrollTop += anchored
          ? messageBubble(anchored).getBoundingClientRect().top - anchor.top
          : scroller.scrollHeight - previousHeight
      })
    } catch (error) { store.setError(errorMessage(error)) }
    finally { if (useAppStore.getState().activeId === conversationId) setHistoryLoading(false) }
  }

  async function loadLatestMessages() {
    const conversationId = useAppStore.getState().activeId
    if (!conversationId || historyLoading) return
    setHistoryLoading(true)
    try {
      const page = await window.nocturne.conversations.messagePage(conversationId)
      if (useAppStore.getState().activeId !== conversationId) return
      store.setMessages(page.items)
      historyOffsetRef.current = page.items.length
      setHistoryHasMore(page.hasMore)
      setHistoryHasNewer(false)
      stickToBottomRef.current = true
      window.requestAnimationFrame(() => {
        const scroller = chatScrollRef.current
        if (scroller) scroller.scrollTop = scroller.scrollHeight
      })
    } catch (error) { store.setError(errorMessage(error)) }
    finally { if (useAppStore.getState().activeId === conversationId) setHistoryLoading(false) }
  }

  async function send(event: FormEvent) {
    event.preventDefault()
    await submitPrompt(prompt)
  }

  async function submitPrompt(rawPrompt: string, mode: AgentMode = agentMode, attachmentsOverride?: Attachment[]) {
    const content = rawPrompt.trim()
    if (!content || interactionLocked()) return
    if (historyHasNewer) await loadLatestMessages()
    let conversationId = store.activeId
    if (!conversationId) {
      await createConversation()
      conversationId = useAppStore.getState().activeId
    }
    if (!conversationId) return
    store.clearRun(); setPrompt('')
    const selectedAttachments = attachmentsOverride ?? attachments
    lastAttemptRef.current = { conversationId, content, mode, attachments: selectedAttachments }
    setRunRetryAvailable(false)
    activeTurnRef.current = { conversationId, mode, suggestionId: applyingSuggestionRef.current?.id ?? null, suggestionFiles: applyingSuggestionRef.current?.affectedFiles ?? [] }
    applyingSuggestionRef.current = null
    setAttachments([])
    store.setStatus('planning')
    store.addMessage({ id: fakeId(), conversationId, role: 'user', content, metadata: JSON.stringify({ attachments: selectedAttachments.map((item) => item.path) }), createdAt: now() })
    try { await window.nocturne.ai.send(conversationId, content, selectedAttachments.map((item) => item.path), mode); await refresh() }
    catch (error) {
      activeTurnRef.current = null; applyingSuggestionRef.current = null; setRunRetryAvailable(true); store.setFinalizing(false); store.setStatus('failed'); store.setError(error instanceof Error ? error.message : String(error))
      try {
        const page = await window.nocturne.conversations.messagePage(conversationId)
        if (useAppStore.getState().activeId === conversationId) {
          store.setMessages(page.items)
          historyOffsetRef.current = page.items.length
          setHistoryHasMore(page.hasMore)
          setHistoryHasNewer(false)
        }
      } catch {
        // Keep the visible error when the post-failure refresh is unavailable.
      }
    }
  }

  function retryLastAttempt() {
    const attempt = lastAttemptRef.current
    if (!attempt || attempt.conversationId !== store.activeId || interactionLocked()) return
    store.setError(null)
    void submitPrompt(attempt.content, attempt.mode, attempt.attachments)
  }

  function preparePrompt(value: string, mode: AgentMode = agentMode) {
    if (interactionLocked()) { store.setError(t('common.waitBeforePrepare')); return }
    setPrompt(value); setAgentMode(mode)
    window.requestAnimationFrame(() => { composerRef.current?.focus(); composerRef.current?.setSelectionRange(value.length, value.length) })
  }

  function notify(message: string) {
    setNotice(message)
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 3_200)
  }

  function handleChatScroll() {
    const scroller = chatScrollRef.current
    if (!scroller) return
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 96
    stickToBottomRef.current = atBottom
    if (atBottom) setNewContent(false)
  }

  function jumpToLatest() {
    if (historyHasNewer) { void loadLatestMessages(); return }
    const scroller = chatScrollRef.current
    if (!scroller) return
    stickToBottomRef.current = true; setNewContent(false)
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  async function attachFiles() {
    if (interactionLocked()) { store.setError(t('common.waitBeforeAttach')); return }
    let conversationId = useAppStore.getState().activeId
    if (!conversationId) {
      await createConversation()
      conversationId = useAppStore.getState().activeId
    }
    if (!conversationId) return
    try {
      const selected = await window.nocturne.files.attach(conversationId)
      setAttachments((current) => [...current, ...selected.filter((file) => !current.some((attached) => attached.path === file.path))].slice(0, 10))
    }
    catch (error) { store.setError(errorMessage(error)) }
  }

  async function cancelRun() {
    if (!store.activeId) return
    store.setStatus('cancelling')
    try {
      await window.nocturne.ai.cancel(store.activeId)
    } catch (error) {
      store.setStatus('failed')
      store.setError(errorMessage(error))
    }
  }

  function handleAgentEvent(event: AgentEvent) {
    const conversationId = typeof event.params.conversationId === 'string'
      ? event.params.conversationId
      : undefined
    if (conversationId && conversationId !== activeTurnRef.current?.conversationId) {
      const recovered = event.method === 'turn/completed' ? persistedAssistantMessage(event.params.persistedMessage, conversationId) : null
      if (recovered && useAppStore.getState().activeId === conversationId && !useAppStore.getState().messages.some((message) => message.id === recovered.id)) {
        store.addMessage(recovered)
        useAppStore.setState({ streaming: '' })
        void collections.loadConversationCollections(conversationId)
        void refreshGit(conversationId)
      }
      return
    }
    routeAgentEvent(event, { stream: queueStreamDelta, activityDetail: appendActivityDetail, diff: store.setDiff, plan: store.setPlan, hasPlan: () => Boolean(useAppStore.getState().plan.length), itemStarted: addItemActivity, itemCompleted: completeItem, fsChanged: (paths) => { if (paths.length) store.upsertActivity({ id: 'fs-summary', type: 'file', label: t('common.filesObserved', { count: paths.length }), detail: paths.slice(-50).join('\n'), status: 'completed' }) }, approval: (value) => store.addApproval({ ...value, status: 'pending' }), turnCompleted: (params) => { void finishTurn(params).catch((error) => { store.setStatus('failed'); store.setError(`${t('common.failedToFinish')}: ${errorMessage(error)}`) }) }, error: (message) => { setRunRetryAvailable(true); store.setError(message); store.upsertActivity({ id: `error-${Date.now()}`, type: 'error', label: t('common.executionError'), detail: message, status: 'failed' }) }, warning: (message) => store.upsertActivity({ id: `warning-${Date.now()}`, type: 'error', label: t('common.warning'), detail: message, status: 'failed' }) })
  }

  async function decide(key: string, accepted: boolean) {
    try { await window.nocturne.ai.approve(key, accepted); store.resolveApproval(key, accepted ? 'accepted' : 'declined') }
    catch (error) { store.setError(errorMessage(error)) }
  }

  async function persistSuggestionStatus(suggestion: Suggestion, status: SuggestionStatus) {
    if (!store.activeId) throw new Error(t('common.openConversationForSuggestion'))
    await window.nocturne.suggestions.status(store.activeId, suggestion.id, status)
    await collections.refreshSuggestions(store.activeId)
  }

  async function updateSuggestion(suggestion: Suggestion, status: SuggestionStatus) {
    try { await persistSuggestionStatus(suggestion, status) }
    catch (error) { store.setError(errorMessage(error)) }
  }

  async function applySuggestion(suggestion: Suggestion) {
    if (!store.activeId || interactionLocked()) return
    const steps: PlanStep[] = [
      { step: t('common.confirmScope', { count: suggestion.affectedFiles.length || 1 }), status: 'pending' },
      { step: t('common.applyApprovedProposal'), status: 'pending' },
      { step: t('common.runValidation'), status: 'pending' },
      { step: t('common.reportChanges'), status: 'pending' },
    ]
    const files = suggestion.affectedFiles.length ? suggestion.affectedFiles.join('\n• ') : t('common.filesToConfirm')
    if (!await confirmation.confirm({ title: t('common.applySuggestionConfirm'), description: `${suggestion.title}\n\n${t('common.filesLabel')}:\n• ${files}\n\n${t('common.approvedScopeDescription')}`, confirmLabel: t('common.prepareApplication') })) return
    try { await persistSuggestionStatus(suggestion, 'accepted') }
    catch (error) { store.setError(`${t('common.suggestionNotAccepted')}: ${errorMessage(error)}`); return }
    store.setPlan(steps, `${t('common.suggestionApplication')}: ${suggestion.title}`)
    applyingSuggestionRef.current = { id: suggestion.id, affectedFiles: suggestion.affectedFiles }
    await submitPrompt(`${t('quick.applySuggestion')}\n\n${t('quick.title')}: ${suggestion.title}\n${t('quick.problem')}: ${suggestion.description}\n${t('quick.reasoning')}: ${suggestion.reasoning}\n${t('quick.files')}: ${suggestion.affectedFiles.join(', ') || t('common.identifyBeforeEditing')}\n${t('quick.proposal')}:\n${suggestion.proposedChanges}`, 'build')
  }

  async function removeConversation(id: string) {
    if (interactionLocked()) { store.setError(t('common.waitBeforeDelete')); return }
    const conversation = store.conversations.find((item) => item.id === id)
    if (!await confirmation.confirm({ title: t('common.deleteConversationConfirm'), description: `"${conversation?.title || t('common.thisConversation')}" ${t('common.conversationRemoved')}`, confirmLabel: t('common.deleteConversation'), danger: true })) return
    try {
      await window.nocturne.conversations.delete(id)
      if (store.activeId === id) { store.setActive(null); store.setMessages([]); store.setArtifacts([]); historyOffsetRef.current = 0; setHistoryHasMore(false); setHistoryHasNewer(false); setPreview(null) }
      await refresh()
    } catch (error) {
      store.setError(errorMessage(error))
    }
  }

  function restoreMetadata(metadata: string) {
    try {
      const parsed = JSON.parse(metadata) as { diff?: string; activities?: Activity[]; files?: ChangedFile[]; plan?: PlanStep[]; planExplanation?: string }
      if (parsed.diff) store.setDiff(parsed.diff)
      if (parsed.activities) parsed.activities.forEach(store.upsertActivity)
      if (parsed.files) store.setFiles(parsed.files)
      if (parsed.plan) store.setPlan(parsed.plan, parsed.planExplanation)
    } catch { /* metadata from older versions is optional */ }
  }

  async function refreshGit(conversationId = store.activeId) {
    if (!conversationId) return
    try { const info = await window.nocturne.git.status(conversationId); setGitInfo(info); if (info.diff && !useAppStore.getState().diff) store.setDiff(info.diff) }
    catch { setGitInfo(null) }
  }

  async function saveSettings(next: AppSettings) {
    try { const saved = await window.nocturne.settings.set(next); const updatedLanguage = saved.language === 'en' ? 'en' : 'pt-BR'; const updated = { ...next, ...saved, theme: saved.theme === 'light' ? 'light' : 'dark', language: updatedLanguage } as AppSettings; setSettings(updated); setLanguage(updatedLanguage); setSettingsOpen(false); notify(translate(updatedLanguage, 'common.saved')) }
    catch (error) { throw new Error(errorMessage(error)) }
  }

  async function saveCodexModel(model: string) {
    try {
      const saved = await window.nocturne.settings.set({ model })
      setSettings((current) => ({ ...current, ...saved }))
    } catch (error) {
      throw new Error(errorMessage(error))
    }
  }

  async function showFilePreview(filePath: string) {
    if (!store.activeId) return
    try { setPreview(await window.nocturne.files.preview(store.activeId, filePath)) }
    catch (error) { store.setError(errorMessage(error)) }
  }

  function showArtifact(artifact: import('./types').Artifact) {
    if (artifact.filePath) {
      if (/\.(pdf|docx)$/i.test(artifact.filePath)) { if (store.activeId) void window.nocturne.files.open(store.activeId, artifact.filePath, 'file').catch((error) => store.setError(errorMessage(error))); return }
      void showFilePreview(artifact.filePath); return
    }
    setPreview({ kind: artifact.type === 'response' || artifact.type === 'document' ? 'markdown' : 'text', name: artifact.title, filePath: '', mime: 'text/plain', content: artifact.content || '', size: artifact.content?.length || 0 })
  }

  async function deleteArtifact(artifactId: string) {
    const conversationId = useAppStore.getState().activeId
    if (!conversationId) return
    if (!await confirmation.confirm({ title: t('common.removeArtifact'), description: t('common.artifactRemoved'), confirmLabel: t('common.remove'), danger: true })) return
    const previous = useAppStore.getState().artifacts
    store.setArtifacts(previous.filter((artifact) => artifact.id !== artifactId))
    try {
      await window.nocturne.artifacts.delete(conversationId, artifactId)
      if (useAppStore.getState().activeId === conversationId) await collections.refreshArtifacts(conversationId)
      if (preview) setPreview(null)
    } catch (error) {
      if (useAppStore.getState().activeId === conversationId) store.setArtifacts(previous)
      store.setError(errorMessage(error))
    }
  }

  async function refreshArtifacts() { await collections.refreshArtifacts(store.activeId) }

  async function saveMemory(content: string, rules: string) {
    if (!store.activeId) return
    try { setMemory(await window.nocturne.memory.set(store.activeId, content, rules)); setMemoryOpen(false); notify(t('memory.saved')) }
    catch (error) { throw new Error(errorMessage(error)) }
  }

  async function openWorkspaceTool(tool: 'editor' | 'terminal') {
    if (!pathLabel) return
    try { await window.nocturne.workspace.openTool(pathLabel, tool); notify(tool === 'editor' ? t('common.openWorkspace') : t('common.openTerminal')) }
    catch (error) { store.setError(errorMessage(error)) }
  }

  async function favoriteWorkspace(item: Workspace) {
    try { await window.nocturne.workspace.favorite(item.path, !item.favorite); setWorkspaces(await window.nocturne.workspace.list()); notify(item.favorite ? t('common.favoriteRemoved') : t('common.favoriteAdded')) }
    catch (error) { store.setError(errorMessage(error)) }
  }

  const title = active?.title ?? t('common.newConversation')
  const pathLabel = active?.workspace ?? workspace

  return <div className="app-shell">
    {compactLayout && sidebarOpen && <button tabIndex={-1} className="panel-backdrop sidebar-backdrop" aria-label={t('nav.closeSidebar')} onClick={() => setSidebarVisibility(false)}/>}
    <Sidebar open={sidebarOpen} compact={compactLayout} triggerRef={sidebarTriggerRef} conversations={filtered} hasConversations={store.conversations.length > 0} hasMore={collections.conversationHasMore} loadingMore={collections.loading === 'conversations'} activeId={store.activeId} search={search} searchRef={searchRef} workspace={workspace} workspaces={workspaces} settings={settings} status={store.status} onClose={() => setSidebarVisibility(false)} onNew={() => void createConversation().finally(() => { if (compactLayout) setSidebarVisibility(false) })} onSearch={setSearch} onLoadMore={() => void collections.loadMoreConversations()} onConversation={(id) => void openConversation(id).finally(() => { if (compactLayout) setSidebarVisibility(false) })} onDelete={(id) => void removeConversation(id)} onWorkspace={() => void selectWorkspace().finally(() => { if (compactLayout) setSidebarVisibility(false) })} onSavedWorkspace={(path) => void chooseSavedWorkspace(path).finally(() => { if (compactLayout) setSidebarVisibility(false) })} onFavorite={(item) => void favoriteWorkspace(item)} onSettings={() => { if (compactLayout) setSidebarVisibility(false); setSettingsOpen(true) }}/>

    <main className="main-panel">
      <WorkspaceTopbar title={title} pathLabel={pathLabel} gitInfo={gitInfo} status={store.status} sidebarOpen={sidebarOpen} inspectorOpen={rightOpen} compact={compactLayout} hasMemory={Boolean(memory.content)} sidebarTriggerRef={sidebarTriggerRef} inspectorTriggerRef={inspectorTriggerRef} onOpenSidebar={() => setSidebarVisibility(true)} onSelectWorkspace={() => void selectWorkspace()} onOpenTool={(tool) => void openWorkspaceTool(tool)} onMemory={() => store.activeId ? setMemoryOpen(true) : store.setError(t('common.noWorkspace'))} onSettings={() => setSettingsOpen(true)} onToggleInspector={() => setInspectorVisibility(!rightOpen)}/>

      <ChatViewport active={Boolean(store.activeId)} messages={store.messages} error={store.error} historyHasMore={historyHasMore} historyHasNewer={historyHasNewer} historyLoading={historyLoading} newContent={newContent} chatScrollRef={chatScrollRef} endRef={endRef} stickToBottomRef={stickToBottomRef} onNew={() => void createConversation()} onWorkspace={() => void selectWorkspace()} onPrompt={preparePrompt} onLoadOlder={() => void loadOlderMessages()} onLoadLatest={() => void loadLatestMessages()} onScroll={handleChatScroll} onNewContent={setNewContent} onDismissError={() => store.setError(null)} onRetryError={runRetryAvailable && lastAttemptRef.current?.conversationId === store.activeId ? retryLastAttempt : undefined} onJumpLatest={jumpToLatest}/>

      <Composer agentMode={agentMode} attachments={attachments} prompt={prompt} status={store.status} finalizing={store.finalizing} active={Boolean(store.activeId)} pendingApprovals={store.approvals.filter((item) => item.status === 'pending').length} composerRef={composerRef} onMode={setAgentMode} onPrompt={setPrompt} onRemoveAttachment={(path) => setAttachments((current) => current.filter((file) => file.path !== path))} onAttach={attachFiles} onCancel={cancelRun} onSubmit={send} onQuick={preparePrompt}/>
    </main>
    {compactLayout && rightOpen && <button tabIndex={-1} className="panel-backdrop inspector-backdrop" aria-label={t('topbar.closeAgent')} onClick={() => setInspectorVisibility(false)}/>}

    <Suspense fallback={null}><AgentPanel open={rightOpen} compact={compactLayout} triggerRef={inspectorTriggerRef} gitInfo={gitInfo} artifactsHaveMore={collections.artifactHasMore} suggestionsHaveMore={collections.suggestionHasMore} loadingCollection={collections.loading} onClose={() => setInspectorVisibility(false)} onDecide={decide} onError={store.setError} onNotify={notify} onGitRefresh={refreshGit} onArtifactsRefresh={refreshArtifacts} onLoadMoreArtifacts={() => void collections.loadMoreArtifacts()} onLoadMoreSuggestions={() => void collections.loadMoreSuggestions()} onPreview={showFilePreview} onArtifact={showArtifact} onDeleteArtifact={deleteArtifact} onSuggestionStatus={updateSuggestion} onSuggestionApply={applySuggestion} onPlanChange={(plan) => store.setPlan(plan, useAppStore.getState().planExplanation)} onPlanExecute={(plan) => preparePrompt(`${t('quick.executePlan')}\n\n${plan.map((item, index) => `${index + 1}. ${item.step}`).join('\n')}`, 'build')}/></Suspense>
    {confirmation.dialog}<AppOverlays settingsOpen={settingsOpen} settings={settings} status={store.status} workspaces={workspaces} memoryOpen={memoryOpen} memory={memory} preview={preview} onboardingOpen={onboardingOpen} activeId={store.activeId} workspace={workspace} onSettingsClose={() => setSettingsOpen(false)} onSaveSettings={saveSettings} onCodexModelChange={saveCodexModel} onNotify={notify} onOpenOnboarding={() => { setSettingsOpen(false); setOnboardingOpen(true) }} onMemoryClose={() => setMemoryOpen(false)} onOpenBrain={() => { setMemoryOpen(false); setBrainOpen(true) }} onSaveMemory={saveMemory} onPreviewClose={() => setPreview(null)} onError={store.setError} onWorkspace={selectWorkspace} onOpenSettings={() => { setOnboardingOpen(false); setSettingsOpen(true) }} onDismissOnboarding={() => { setOnboardingOpen(false); composerRef.current?.focus() }} onCompleteOnboarding={() => { localStorage.setItem('nocturne.onboarding.completed', 'true'); setOnboardingOpen(false); notify(t('common.reloaded')); composerRef.current?.focus() }}/><Suspense fallback={null}>{brainOpen && store.activeId && <BrainMemoryDialog conversationId={store.activeId} onClose={() => setBrainOpen(false)} onNotify={notify}/>}</Suspense>{notice && <div className="product-toast" role="status" aria-live="polite"><span>{notice}</span><button aria-label={t('common.close')} onClick={() => setNotice(null)}><X size={14}/></button></div>}
  </div>
}

export default App

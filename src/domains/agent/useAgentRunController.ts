import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import type { AgentEvent, AgentMode, Attachment, Conversation } from '../../types'
import { useAppStore } from '../../store'
import { errorMessage } from '../../shared/format'
import { useI18n } from '../../shared/i18n'
import { persistedAssistantMessage, useTurnLifecycle, type ActiveTurnContext } from './useTurnLifecycle'
import { routeAgentEvent } from './routeCodexEvent'
import { useBufferedAgentEvents } from './useBufferedCodexEvents'

interface AgentRunControllerOptions {
  hasNewerMessages: boolean
  composerRef: RefObject<HTMLTextAreaElement | null>
  isInteractionLocked(): boolean
  onCreateConversation(): Promise<void>
  onLoadLatestMessages(): Promise<void>
  onRefreshConversations(): Promise<Conversation[]>
  onRefreshCollections(conversationId: string): Promise<void>
  onRefreshGit(conversationId: string): Promise<void>
}

export function useAgentRunController({ hasNewerMessages, composerRef, isInteractionLocked, onCreateConversation, onLoadLatestMessages, onRefreshConversations, onRefreshCollections, onRefreshGit }: AgentRunControllerOptions) {
  const { t } = useI18n()
  const [prompt, setPrompt] = useState('')
  const [agentMode, setAgentMode] = useState<AgentMode>('review')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [runRetryAvailable, setRunRetryAvailable] = useState(false)
  const activeConversationId = useAppStore((state) => state.activeId)
  const activeTurnRef = useRef<ActiveTurnContext | null>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const retiredRunIdsRef = useRef(new Set<string>())
  const acceptedSequencesRef = useRef(new Map<string, number>())
  const applyingSuggestionRef = useRef<{ id: string; affectedFiles: string[] } | null>(null)
  const lastAttemptRef = useRef<{ conversationId: string; content: string; mode: AgentMode; attachments: Attachment[] } | null>(null)
  const { queueStreamDelta, flushStream, appendActivityDetail, addItemActivity, completeItem } = useBufferedAgentEvents()
  const finishTurn = useTurnLifecycle({ flushStream, activeTurnRef, refreshGit: onRefreshGit })
  const dependenciesRef = useRef({ composerRef, isInteractionLocked, onCreateConversation, onLoadLatestMessages, onRefreshConversations, onRefreshCollections, onRefreshGit, finishTurn })
  dependenciesRef.current = { composerRef, isInteractionLocked, onCreateConversation, onLoadLatestMessages, onRefreshConversations, onRefreshCollections, onRefreshGit, finishTurn }

  const submitPrompt = useCallback(async (rawPrompt: string, mode: AgentMode = agentMode, attachmentsOverride?: Attachment[]) => {
    const content = rawPrompt.trim()
    if (!content || isInteractionLocked()) return
    if (hasNewerMessages) await onLoadLatestMessages()
    let conversationId = useAppStore.getState().activeId
    if (!conversationId) {
      await onCreateConversation()
      conversationId = useAppStore.getState().activeId
    }
    if (!conversationId) return
    const store = useAppStore.getState()
    if (activeRunIdRef.current) retiredRunIdsRef.current.add(activeRunIdRef.current)
    activeRunIdRef.current = null
    store.clearRun()
    setPrompt('')
    const selectedAttachments = attachmentsOverride ?? attachments
    lastAttemptRef.current = { conversationId, content, mode, attachments: selectedAttachments }
    setRunRetryAvailable(false)
    activeTurnRef.current = {
      conversationId,
      mode,
      suggestionId: applyingSuggestionRef.current?.id ?? null,
      suggestionFiles: applyingSuggestionRef.current?.affectedFiles ?? [],
      runId: null,
    }
    applyingSuggestionRef.current = null
    setAttachments([])
    store.setStatus('planning')
    store.addMessage({
      id: crypto.randomUUID(),
      conversationId,
      role: 'user',
      content,
      metadata: JSON.stringify({ attachments: selectedAttachments.map((item) => item.path) }),
      createdAt: new Date().toISOString(),
    })
    try {
      await window.nocturne.ai.send(conversationId, content, selectedAttachments.map((item) => item.path), mode)
      await onRefreshConversations()
    } catch (error) {
      if (activeRunIdRef.current) retiredRunIdsRef.current.add(activeRunIdRef.current)
      activeRunIdRef.current = null
      activeTurnRef.current = null
      applyingSuggestionRef.current = null
      setRunRetryAvailable(true)
      const nextStore = useAppStore.getState()
      nextStore.setFinalizing(false)
      nextStore.setStatus('failed')
      nextStore.setError(errorMessage(error))
      await onLoadLatestMessages()
    }
  }, [agentMode, attachments, hasNewerMessages, isInteractionLocked, onCreateConversation, onLoadLatestMessages, onRefreshConversations])

  const send = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await submitPrompt(prompt)
  }, [prompt, submitPrompt])

  const retryLastAttempt = useCallback(() => {
    const attempt = lastAttemptRef.current
    const activeId = useAppStore.getState().activeId
    if (!attempt || attempt.conversationId !== activeId || isInteractionLocked()) return
    useAppStore.getState().setError(null)
    void submitPrompt(attempt.content, attempt.mode, attempt.attachments)
  }, [isInteractionLocked, submitPrompt])

  const preparePrompt = useCallback((value: string, mode: AgentMode = agentMode) => {
    if (isInteractionLocked()) {
      useAppStore.getState().setError(t('common.waitBeforePrepare'))
      return
    }
    setPrompt(value)
    setAgentMode(mode)
    window.requestAnimationFrame(() => {
      const textarea = composerRef.current
      textarea?.focus()
      textarea?.setSelectionRange(value.length, value.length)
    })
  }, [agentMode, composerRef, isInteractionLocked, t])

  const attachFiles = useCallback(async () => {
    if (isInteractionLocked()) {
      useAppStore.getState().setError(t('common.waitBeforeAttach'))
      return
    }
    let conversationId = useAppStore.getState().activeId
    if (!conversationId) {
      await onCreateConversation()
      conversationId = useAppStore.getState().activeId
    }
    if (!conversationId) return
    try {
      const selected = await window.nocturne.files.attach(conversationId)
      setAttachments((current) => [...current, ...selected.filter((file) => !current.some((attached) => attached.path === file.path))].slice(0, 10))
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    }
  }, [isInteractionLocked, onCreateConversation, t])

  const cancelRun = useCallback(async () => {
    const conversationId = useAppStore.getState().activeId
    if (!conversationId) return
    useAppStore.getState().setStatus('cancelling')
    try {
      await window.nocturne.ai.cancel(conversationId)
    } catch (error) {
      const store = useAppStore.getState()
      store.setStatus('failed')
      store.setError(errorMessage(error))
    }
  }, [])

  const decide = useCallback(async (key: string, accepted: boolean) => {
    try {
      await window.nocturne.ai.approve(key, accepted)
      useAppStore.getState().resolveApproval(key, accepted ? 'accepted' : 'declined')
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    }
  }, [])

  const acceptSequence = useCallback((runId: string | undefined, sequence: number | undefined) => {
    if (!runId || sequence === undefined) return true
    if (!Number.isSafeInteger(sequence)) return false
    const previous = acceptedSequencesRef.current.get(runId)
    if (previous !== undefined && sequence <= previous) return false
    acceptedSequencesRef.current.set(runId, sequence)
    if (acceptedSequencesRef.current.size > 256) {
      const oldest = acceptedSequencesRef.current.keys().next().value
      if (typeof oldest === 'string') acceptedSequencesRef.current.delete(oldest)
    }
    return true
  }, [])

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    const store = useAppStore.getState()
    const conversationId = typeof event.params.conversationId === 'string' ? event.params.conversationId : undefined
    const runId = typeof event.runId === 'string'
      ? event.runId
      : typeof event.params.runId === 'string' ? event.params.runId : undefined
    const sequence = typeof event.sequence === 'number'
      ? event.sequence
      : typeof event.params.sequence === 'number' ? event.params.sequence : undefined
    const activeTurn = activeTurnRef.current
    const belongsToActiveTurn = !conversationId || !activeTurn || conversationId === activeTurn.conversationId
    if (runId && retiredRunIdsRef.current.has(runId)) return
    if (!acceptSequence(runId, sequence)) return
    if (runId && belongsToActiveTurn) {
      if (activeRunIdRef.current && activeRunIdRef.current !== runId) return
      if (!activeRunIdRef.current && activeTurn) {
        activeRunIdRef.current = runId
        activeTurn.runId = runId
      }
    }
    if (conversationId && conversationId !== activeTurnRef.current?.conversationId) {
      if (runId && event.method === 'turn/completed') retiredRunIdsRef.current.add(runId)
      const recovered = event.method === 'turn/completed' ? persistedAssistantMessage(event.params.persistedMessage, conversationId) : null
      if (recovered && store.activeId === conversationId && !store.messages.some((message) => message.id === recovered.id)) {
        store.addMessage(recovered)
        useAppStore.setState({ streaming: '' })
        void dependenciesRef.current.onRefreshCollections(conversationId)
        void dependenciesRef.current.onRefreshGit(conversationId)
      }
      return
    }
    routeAgentEvent(event, {
      stream: queueStreamDelta,
      activityDetail: appendActivityDetail,
      diff: store.setDiff,
      plan: store.setPlan,
      hasPlan: () => Boolean(useAppStore.getState().plan.length),
      itemStarted: addItemActivity,
      itemCompleted: completeItem,
      fsChanged: (paths) => {
        if (paths.length) useAppStore.getState().upsertActivity({ id: 'fs-summary', type: 'file', label: t('common.filesObserved', { count: paths.length }), detail: paths.slice(-50).join('\n'), status: 'completed' })
      },
      approval: (value) => useAppStore.getState().addApproval({ ...value, status: 'pending' }),
      turnCompleted: (params) => {
        const completedRunId = typeof params.runId === 'string' ? params.runId : activeRunIdRef.current
        if (completedRunId) retiredRunIdsRef.current.add(completedRunId)
        void dependenciesRef.current.finishTurn(params)
          .catch((error) => {
            const nextStore = useAppStore.getState()
            nextStore.setStatus('failed')
            nextStore.setError(`${t('common.failedToFinish')}: ${errorMessage(error)}`)
          })
          .finally(() => {
            if (completedRunId && activeRunIdRef.current === completedRunId) activeRunIdRef.current = null
          })
      },
      error: (message) => {
        setRunRetryAvailable(true)
        const nextStore = useAppStore.getState()
        nextStore.setError(message)
        nextStore.upsertActivity({ id: `error-${Date.now()}`, type: 'error', label: t('common.executionError'), detail: message, status: 'failed' })
      },
      warning: (message) => useAppStore.getState().upsertActivity({ id: `warning-${Date.now()}`, type: 'error', label: t('common.warning'), detail: message, status: 'failed' }),
    })
  }, [acceptSequence, addItemActivity, appendActivityDetail, completeItem, queueStreamDelta, t])

  const markSuggestionApplication = useCallback((id: string, affectedFiles: string[]) => {
    applyingSuggestionRef.current = { id, affectedFiles }
  }, [])

  const removeAttachment = useCallback((path: string) => {
    setAttachments((current) => current.filter((file) => file.path !== path))
  }, [])

  const retryAvailableForActiveConversation = runRetryAvailable && lastAttemptRef.current?.conversationId === activeConversationId

  useEffect(() => {
    const offStatus = window.nocturne.ai.onStatus(({ status, conversationId, runId, sequence, error }) => {
      if (runId && retiredRunIdsRef.current.has(runId)) return
      if (!acceptSequence(runId, sequence)) return
      if (conversationId && conversationId !== activeTurnRef.current?.conversationId) return
      if (runId) {
        if (activeRunIdRef.current && activeRunIdRef.current !== runId) return
        if (!activeRunIdRef.current && activeTurnRef.current) {
          activeRunIdRef.current = runId
          activeTurnRef.current.runId = runId
        }
      }
      const store = useAppStore.getState()
      store.setStatus(status)
      if (status === 'completed' && activeTurnRef.current) store.setFinalizing(true)
      if (error) store.setError(error)
    })
    const offEvent = window.nocturne.ai.onEvent(handleAgentEvent)
    return () => { offStatus(); offEvent() }
  }, [acceptSequence, handleAgentEvent])

  return {
    prompt,
    agentMode,
    attachments,
    runRetryAvailable,
    retryAvailableForActiveConversation,
    setPrompt,
    setAgentMode,
    removeAttachment,
    submitPrompt,
    send,
    retryLastAttempt,
    preparePrompt,
    attachFiles,
    cancelRun,
    decide,
    markSuggestionApplication,
  }
}

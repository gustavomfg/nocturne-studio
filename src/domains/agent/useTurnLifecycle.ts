import { useRef, type MutableRefObject } from 'react'
import type { AgentMode, Message } from '../../types'
import { useAppStore } from '../../store'
import { useShallow } from 'zustand/react/shallow'
import { PERSISTENCE_LIMITS } from '../../../shared/constants'
import { isJsonValueWithinLimit } from '../../../shared/json'
import { useI18n } from '../../shared/i18n'

export interface ActiveTurnContext { conversationId: string; mode: AgentMode; suggestionId: string | null; suggestionFiles: string[] }

export function useTurnLifecycle({ flushStream, activeTurnRef, refreshGit }: { flushStream(): void; activeTurnRef: MutableRefObject<ActiveTurnContext | null>; refreshGit(conversationId: string): Promise<void> }) {
  const { t } = useI18n()
  const processingTurnsRef = useRef(new Set<string>())
  const persistedTurnsRef = useRef(new Set<string>())
  const store = useAppStore(useShallow((state) => ({
    setFinalizing: state.setFinalizing, setError: state.setError, upsertActivity: state.upsertActivity, setSuggestions: state.setSuggestions, addMessage: state.addMessage, setArtifacts: state.setArtifacts,
  })))

  return async (params: Record<string, unknown>) => {
    flushStream()
    const state = useAppStore.getState()
    const context = activeTurnRef.current
    const turn = params.turn as Record<string, unknown> | undefined
    const completionKey = String(turn?.id ?? `${params.threadId ?? 'thread'}:${state.streaming.length}`)
    if (!context || persistedTurnsRef.current.has(completionKey) || processingTurnsRef.current.has(completionKey)) return
    processingTurnsRef.current.add(completionKey)
    store.setFinalizing(true)
    try {
      const error = turn?.error as Record<string, unknown> | undefined
      const cancelled = turn?.status === 'cancelled'
      const persistedMessage = persistedAssistantMessage(params.persistedMessage, context.conversationId)
      let persistenceRejected = false
      const persistenceWarning = typeof params.persistenceWarning === 'string' ? params.persistenceWarning : ''
      if (error) store.setError(String(error.message ?? t('common.runNotCompleted')))
      if (persistenceWarning) store.setError(persistenceWarning)
      store.upsertActivity({ id: `completion-${String(turn?.id ?? Date.now())}`, type: 'completion', label: error ? t('agent.executionErrorEnded') : cancelled ? t('agent.executionCancelled') : t('agent.executionCompleted'), status: error ? 'failed' : 'completed' })
      if (persistedMessage) {
        if (useAppStore.getState().activeId === context.conversationId && !useAppStore.getState().messages.some((message) => message.id === persistedMessage.id)) store.addMessage(persistedMessage)
        useAppStore.setState({ streaming: '' })
        if (useAppStore.getState().activeId === context.conversationId) {
          store.setSuggestions((await window.nocturne.suggestions.page(context.conversationId)).items)
          store.setArtifacts((await window.nocturne.artifacts.page(context.conversationId)).items)
        }
      } else if (state.streaming) {
      const current = useAppStore.getState()
      const activitySnapshot = current.activities.slice(-100).map(({ detail, ...activity }) => ({ ...activity, ...(detail === undefined ? {} : { detail: detail.slice(-4_000) }) }))
      const metadata = {
        diff: current.diff.slice(-PERSISTENCE_LIMITS.metadataCharacters),
        activities: activitySnapshot,
        files: current.files.slice(-300).map(({ path, kind, status }) => ({ path, kind, status })),
        plan: current.plan.slice(-100).map(({ step, status }) => ({ step, status })),
        planExplanation: current.planExplanation.slice(-20_000),
      }
      if (!isJsonValueWithinLimit(metadata, PERSISTENCE_LIMITS.metadataCharacters)) {
        persistenceRejected = true
        store.setError(t('common.metadataLimitExceeded'))
        useAppStore.setState({ streaming: '' })
      } else {
        let assistantContent = state.streaming
        const memoryExtraction = await window.nocturne.brain.extract(context.conversationId, assistantContent)
        assistantContent = memoryExtraction.content || (memoryExtraction.memories.length ? t('memory.candidatesSent', { count: memoryExtraction.memories.length }) : t('common.noPersistableContent'))
        if (memoryExtraction.warning) store.setError(memoryExtraction.warning)
        if (context.mode === 'review') {
          const extracted = await window.nocturne.suggestions.create(context.conversationId, assistantContent)
          assistantContent = extracted.content || assistantContent
          if (extracted.warning) store.setError(extracted.warning)
          if (useAppStore.getState().activeId === context.conversationId) store.setSuggestions((await window.nocturne.suggestions.page(context.conversationId)).items)
        }
        const saved = await window.nocturne.ai.saveAssistant(context.conversationId, assistantContent, metadata)
        if (useAppStore.getState().activeId === context.conversationId) store.addMessage(saved)
        useAppStore.setState({ streaming: '' })
        if (useAppStore.getState().activeId === context.conversationId) store.setArtifacts((await window.nocturne.artifacts.page(context.conversationId)).items)
      }
    }
    if (context.suggestionId && !persistenceRejected) {
      const changedInApprovedScope = hasAppliedSuggestionChanges(context.suggestionFiles, useAppStore.getState().files.map((file) => file.path))
      if (!error && !cancelled && changedInApprovedScope) await window.nocturne.suggestions.status(context.conversationId, context.suggestionId, 'resolved', t('common.completedWithChanges'))
      if (useAppStore.getState().activeId === context.conversationId) store.setSuggestions((await window.nocturne.suggestions.page(context.conversationId)).items)
    }
      await refreshGit(context.conversationId)
      persistedTurnsRef.current.add(completionKey)
      if (persistedTurnsRef.current.size > 100) persistedTurnsRef.current.delete(persistedTurnsRef.current.values().next().value as string)
      if (activeTurnRef.current === context) activeTurnRef.current = null
    } finally {
      processingTurnsRef.current.delete(completionKey)
      store.setFinalizing(false)
    }
  }
}

export function hasAppliedSuggestionChanges(expectedFiles: string[], observedFiles: string[]) {
  if (!observedFiles.length) return false
  if (!expectedFiles.length) return true
  const observed = observedFiles.map(normalizePath)
  return expectedFiles.every((expectedFile) => {
    const expected = normalizePath(expectedFile)
    return observed.some((file) => file === expected || file.endsWith(`/${expected}`))
  })
}

function normalizePath(value: string) { return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '') }

export function persistedAssistantMessage(value: unknown, conversationId: string): Message | null {
  if (!value || typeof value !== 'object') return null
  const message = value as Partial<Message>
  if (message.role !== 'assistant' || message.conversationId !== conversationId || typeof message.id !== 'string' || typeof message.content !== 'string' || typeof message.createdAt !== 'string') return null
  return { id: message.id, conversationId, role: 'assistant', content: message.content, metadata: typeof message.metadata === 'string' ? message.metadata : null, createdAt: message.createdAt }
}

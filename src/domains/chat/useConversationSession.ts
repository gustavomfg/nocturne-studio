import { useCallback, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import type { Conversation, Workspace, WorkspaceMemory } from '../../types'
import { errorMessage } from '../../shared/format'
import { RENDERER_LIMITS } from '../../../shared/constants'
import { useAppStore } from '../../store'
import { useI18n } from '../../shared/i18n'

interface ConfirmationOptions {
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
}

interface ConversationSessionOptions {
  conversations: Conversation[]
  availableWorkspaces: Workspace[]
  isInteractionLocked(): boolean
  confirm(options: ConfirmationOptions): Promise<boolean>
  onError(message: string): void
  onSetWorkspace(value: string): void
  onInitializeWorkspaces(value: Workspace[]): void
  onRefreshConversations(): Promise<Conversation[]>
  onLoadCollections(conversationId: string): Promise<void>
  onResetPreview(): void
  onClearMemoryAndGit(): void
  onLoadMemory(conversationId: string): Promise<WorkspaceMemory>
  onSetMemory(value: WorkspaceMemory): void
  onRefreshGit(conversationId: string): Promise<void>
  onRestoreMetadata(metadata: string): void
  onConversationLoaded(durationMs: number): void
  onNewContent(value: boolean): void
  chatScrollRef: RefObject<HTMLElement | null>
  stickToBottomRef: MutableRefObject<boolean>
}

const messageBubble = (entry: HTMLElement) => (
  entry.querySelector<HTMLElement>('.user-row, .assistant-row') ?? entry
)

function visibleMessageAnchor(scroller: HTMLElement) {
  const top = scroller.getBoundingClientRect().top
  const entries = Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-id]'))
  const element = entries.find((entry) => messageBubble(entry).getBoundingClientRect().bottom >= top)
  return element
    ? { id: element.dataset.messageId ?? '', top: messageBubble(element).getBoundingClientRect().top }
    : null
}

export interface ConversationSession {
  historyHasMore: boolean
  historyHasNewer: boolean
  historyLoading: boolean
  chatScrollRef: RefObject<HTMLElement | null>
  stickToBottomRef: MutableRefObject<boolean>
  openConversation(id: string, conversationList?: Conversation[], workspaceList?: Workspace[]): Promise<void>
  loadOlderMessages(): Promise<void>
  loadLatestMessages(): Promise<void>
  resetHistory(): void
}

export function useConversationSession({ conversations, availableWorkspaces, isInteractionLocked, confirm, onError, onSetWorkspace, onInitializeWorkspaces, onRefreshConversations, onLoadCollections, onResetPreview, onClearMemoryAndGit, onLoadMemory, onSetMemory, onRefreshGit, onRestoreMetadata, onConversationLoaded, onNewContent, chatScrollRef, stickToBottomRef }: ConversationSessionOptions): ConversationSession {
  const { t } = useI18n()
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [historyHasNewer, setHistoryHasNewer] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const historyOffsetRef = useRef(0)
  const conversationRequestRef = useRef(0)

  const resetHistory = useCallback(() => {
    historyOffsetRef.current = 0
    setHistoryHasMore(false)
    setHistoryHasNewer(false)
  }, [])

  const openConversation = useCallback(async (id: string, conversationList = conversations, workspaceList = availableWorkspaces) => {
    const loadStartedAt = performance.now()
    const store = useAppStore.getState()
    if (isInteractionLocked() && id !== store.activeId) {
      onError(t('common.waitBeforeConversation'))
      return
    }
    const requestId = ++conversationRequestRef.current
    stickToBottomRef.current = true
    onNewContent(false)
    store.setActive(id)
    store.clearRun()
    const page = await window.nocturne.conversations.messagePage(id)
    if (requestId !== conversationRequestRef.current || useAppStore.getState().activeId !== id) return
    store.setMessages(page.items)
    historyOffsetRef.current = page.items.length
    setHistoryHasMore(page.hasMore)
    setHistoryHasNewer(false)
    const lastMetadata = [...page.items].reverse().find((message) => message.metadata)?.metadata
    if (lastMetadata) onRestoreMetadata(lastMetadata)
    const conversation = conversationList.find((item) => item.id === id)
    if (conversation) onSetWorkspace(conversation.workspace)
    await onLoadCollections(id)
    if (requestId !== conversationRequestRef.current || useAppStore.getState().activeId !== id) return
    onResetPreview()
    const workspaceEntry = conversation && workspaceList.find((item) => item.path === conversation.workspace)
    if (conversation && !workspaceEntry?.authorized) {
      onClearMemoryAndGit()
      const missingWorkspace = workspaceEntry?.availability === 'missing'
      const accepted = await confirm({
        title: missingWorkspace ? t('common.movedWorkspace') : t('common.reauthorizeWorkspace'),
        description: `${missingWorkspace ? t('common.movedWorkspaceDescription') : t('common.restoreWorkspaceDescription')}\n\n${conversation.workspace}`,
        confirmLabel: missingWorkspace ? t('common.locateFolder') : t('common.selectFolder'),
      })
      if (requestId !== conversationRequestRef.current || useAppStore.getState().activeId !== id) return
      if (!accepted) {
        onError(t('common.workspaceUnauthorized'))
        return
      }
      try {
        const selected = await window.nocturne.workspace.select(conversation.workspace)
        if (!selected) {
          onError(t('common.reauthCancelled'))
          return
        }
        const refreshedWorkspaces = await window.nocturne.workspace.list()
        onInitializeWorkspaces(refreshedWorkspaces)
        onSetWorkspace(selected)
        if (selected !== conversation.workspace) await onRefreshConversations()
      } catch (error) {
        onError(errorMessage(error))
        return
      }
    }
    const savedMemory = await onLoadMemory(id)
    if (requestId !== conversationRequestRef.current || useAppStore.getState().activeId !== id) return
    onSetMemory(savedMemory)
    onConversationLoaded(performance.now() - loadStartedAt)
    void onRefreshGit(id)
  }, [availableWorkspaces, confirm, conversations, isInteractionLocked, onClearMemoryAndGit, onConversationLoaded, onError, onInitializeWorkspaces, onLoadCollections, onLoadMemory, onNewContent, onRefreshConversations, onRefreshGit, onRestoreMetadata, onResetPreview, onSetMemory, onSetWorkspace, stickToBottomRef, t])

  const loadOlderMessages = useCallback(async () => {
    const conversationId = useAppStore.getState().activeId
    if (!conversationId || historyLoading || !historyHasMore) return
    const scroller = chatScrollRef.current
    const previousHeight = scroller?.scrollHeight ?? 0
    const anchor = scroller ? visibleMessageAnchor(scroller) : null
    stickToBottomRef.current = false
    onNewContent(false)
    setHistoryLoading(true)
    try {
      const page = await window.nocturne.conversations.messagePage(conversationId, historyOffsetRef.current)
      if (useAppStore.getState().activeId !== conversationId) return
      const current = useAppStore.getState().messages
      const known = new Set(current.map((message) => message.id))
      const older = page.items.filter((message) => !known.has(message.id))
      const combined = [...older, ...current]
      const bounded = combined.length > RENDERER_LIMITS.chatMessages ? combined.slice(0, RENDERER_LIMITS.chatMessages) : combined
      useAppStore.getState().setMessages(bounded)
      historyOffsetRef.current += page.items.length
      setHistoryHasMore(page.hasMore)
      setHistoryHasNewer((currentValue) => currentValue || bounded.length < combined.length)
      window.requestAnimationFrame(() => {
        if (!scroller) return
        const anchored = anchor && Array.from(scroller.querySelectorAll<HTMLElement>('[data-message-id]')).find((entry) => entry.dataset.messageId === anchor.id)
        scroller.scrollTop += anchored
          ? messageBubble(anchored).getBoundingClientRect().top - anchor.top
          : scroller.scrollHeight - previousHeight
      })
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      if (useAppStore.getState().activeId === conversationId) setHistoryLoading(false)
    }
  }, [chatScrollRef, historyHasMore, historyLoading, onError, onNewContent, stickToBottomRef])

  const loadLatestMessages = useCallback(async () => {
    const conversationId = useAppStore.getState().activeId
    if (!conversationId || historyLoading) return
    setHistoryLoading(true)
    try {
      const page = await window.nocturne.conversations.messagePage(conversationId)
      if (useAppStore.getState().activeId !== conversationId) return
      useAppStore.getState().setMessages(page.items)
      historyOffsetRef.current = page.items.length
      setHistoryHasMore(page.hasMore)
      setHistoryHasNewer(false)
      stickToBottomRef.current = true
      onNewContent(false)
      window.requestAnimationFrame(() => {
        const scroller = chatScrollRef.current
        if (scroller) scroller.scrollTop = scroller.scrollHeight
      })
    } catch (error) {
      onError(errorMessage(error))
    } finally {
      if (useAppStore.getState().activeId === conversationId) setHistoryLoading(false)
    }
  }, [chatScrollRef, historyLoading, onError, onNewContent, stickToBottomRef])

  return { historyHasMore, historyHasNewer, historyLoading, chatScrollRef, stickToBottomRef, openConversation, loadOlderMessages, loadLatestMessages, resetHistory }
}

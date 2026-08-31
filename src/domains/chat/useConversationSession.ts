import { useCallback, useRef, type MutableRefObject, type RefObject } from 'react'
import type { Conversation, Workspace, WorkspaceMemory } from '../../types'
import { errorMessage } from '../../shared/format'
import { useAppStore } from '../../store'
import { useI18n } from '../../shared/i18n'
import { useConversationHistory } from './useConversationHistory'

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
  const conversationRequestRef = useRef(0)
  const { historyHasMore, historyHasNewer, historyLoading, initializeHistory, loadOlderMessages, loadLatestMessages, resetHistory } = useConversationHistory({ onError, onNewContent, chatScrollRef, stickToBottomRef })

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
    resetHistory()
    store.setActive(id)
    store.clearRun()
    const page = await window.nocturne.conversations.messagePage(id)
    if (requestId !== conversationRequestRef.current || useAppStore.getState().activeId !== id) return
    store.setMessages(page.items)
    initializeHistory(page)
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
  }, [availableWorkspaces, confirm, conversations, initializeHistory, isInteractionLocked, onClearMemoryAndGit, onConversationLoaded, onError, onInitializeWorkspaces, onLoadCollections, onLoadMemory, onNewContent, onRefreshConversations, onRefreshGit, onRestoreMetadata, onResetPreview, onSetMemory, onSetWorkspace, resetHistory, stickToBottomRef, t])

  return { historyHasMore, historyHasNewer, historyLoading, chatScrollRef, stickToBottomRef, openConversation, loadOlderMessages, loadLatestMessages, resetHistory }
}

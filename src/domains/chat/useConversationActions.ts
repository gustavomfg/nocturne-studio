import { useCallback } from 'react'
import type { Conversation } from '../../types'
import { useAppStore } from '../../store'
import { errorMessage } from '../../shared/format'
import { useI18n } from '../../shared/i18n'

interface ConfirmationOptions {
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
}

interface ConversationActionsOptions {
  workspace: string | null
  activeConversation?: Conversation
  isInteractionLocked(): boolean
  confirm(options: ConfirmationOptions): Promise<boolean>
  onRefresh(): Promise<Conversation[]>
  onSetWorkspace(value: string): void
  onResetHistory(): void
  onResetPreview(): void
}

/** Owns conversation creation and removal so App only composes the domains. */
export function useConversationActions({ workspace, activeConversation, isInteractionLocked, confirm, onRefresh, onSetWorkspace, onResetHistory, onResetPreview }: ConversationActionsOptions) {
  const { t } = useI18n()

  const createConversation = useCallback(async () => {
    if (isInteractionLocked()) {
      useAppStore.getState().setError(t('common.waitBeforeCreate'))
      return
    }
    let selected = workspace || activeConversation?.workspace
    if (!selected) selected = await window.nocturne.workspace.select() ?? ''
    if (!selected) return

    const conversation = await window.nocturne.conversations.create(selected)
    await onRefresh()
    const store = useAppStore.getState()
    store.setActive(conversation.id)
    store.setMessages([])
    store.clearRun()
    onResetHistory()
    onSetWorkspace(selected)
  }, [activeConversation?.workspace, isInteractionLocked, onRefresh, onResetHistory, onSetWorkspace, t, workspace])

  const removeConversation = useCallback(async (id: string) => {
    if (isInteractionLocked()) {
      useAppStore.getState().setError(t('common.waitBeforeDelete'))
      return
    }
    const current = useAppStore.getState()
    const conversation = current.conversations.find((item) => item.id === id)
    const confirmed = await confirm({
      title: t('common.deleteConversationConfirm'),
      description: `"${conversation?.title || t('common.thisConversation')}" ${t('common.conversationRemoved')}`,
      confirmLabel: t('common.deleteConversation'),
      danger: true,
    })
    if (!confirmed) return

    try {
      await window.nocturne.conversations.delete(id)
      const next = useAppStore.getState()
      if (next.activeId === id) {
        next.setActive(null)
        next.setMessages([])
        next.setArtifacts([])
        onResetHistory()
        onResetPreview()
      }
      await onRefresh()
    } catch (error) {
      useAppStore.getState().setError(errorMessage(error))
    }
  }, [confirm, isInteractionLocked, onRefresh, onResetHistory, onResetPreview, t])

  return { createConversation, removeConversation }
}

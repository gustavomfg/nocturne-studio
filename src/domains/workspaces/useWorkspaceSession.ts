import { useCallback, useMemo, useState } from 'react'
import type { Conversation, Workspace } from '../../types'
import { errorMessage } from '../../shared/format'
import { useI18n } from '../../shared/i18n'
import { useWorkspaceWatcher } from './useWorkspaceWatcher'

interface WorkspaceSessionOptions {
  conversations: Conversation[]
  activeConversation: Conversation | undefined
  isInteractionLocked(): boolean
  onError(message: string): void
  onOpenConversation(id: string): Promise<void>
  onClearConversation(): void
  onRefreshGit(conversationId: string): Promise<void>
  onRefreshMemory(conversationId: string): Promise<void>
  onNotify(message: string): void
}

export function useWorkspaceSession({ conversations, activeConversation, isInteractionLocked, onError, onOpenConversation, onClearConversation, onRefreshGit, onRefreshMemory, onNotify }: WorkspaceSessionOptions) {
  const { t } = useI18n()
  const [workspace, setWorkspace] = useState('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])

  const workspaceAuthorized = useMemo(
    () => Boolean(workspaces.find((item) => item.path === workspace)?.authorized),
    [workspace, workspaces],
  )

  const initializeWorkspaces = useCallback((value: Workspace[]) => {
    setWorkspaces(value)
  }, [])

  const setWorkspaceForSession = useCallback((value: string) => {
    setWorkspace(value)
  }, [])

  const selectWorkspace = useCallback(async () => {
    if (isInteractionLocked()) {
      onError(t('common.waitBeforeSwitch'))
      return null
    }
    const selected = await window.nocturne.workspace.select()
    if (!selected) return null
    setWorkspace(selected)
    setWorkspaces(await window.nocturne.workspace.list())
    return selected
  }, [isInteractionLocked, onError, t])

  const chooseSavedWorkspace = useCallback(async (selected: string) => {
    if (isInteractionLocked()) {
      onError(t('common.waitBeforeSwitch'))
      return
    }
    setWorkspace(selected)
    const conversation = conversations.find((item) => item.workspace === selected)
    if (conversation) await onOpenConversation(conversation.id)
    else onClearConversation()
  }, [conversations, isInteractionLocked, onClearConversation, onError, onOpenConversation, t])

  const openWorkspaceTool = useCallback(async (tool: 'editor' | 'terminal') => {
    const pathLabel = activeConversation?.workspace || workspace
    if (!pathLabel) return
    try {
      await window.nocturne.workspace.openTool(pathLabel, tool)
      onNotify(tool === 'editor' ? t('common.openWorkspace') : t('common.openTerminal'))
    } catch (error) {
      onError(errorMessage(error))
    }
  }, [activeConversation?.workspace, onError, onNotify, t, workspace])

  const favoriteWorkspace = useCallback(async (item: Workspace) => {
    try {
      await window.nocturne.workspace.favorite(item.path, !item.favorite)
      setWorkspaces(await window.nocturne.workspace.list())
      onNotify(item.favorite ? t('common.favoriteRemoved') : t('common.favoriteAdded'))
    } catch (error) {
      onError(errorMessage(error))
    }
  }, [onError, onNotify, t])

  useWorkspaceWatcher({ workspace, workspaceAuthorized, activeConversation, onError, onRefreshGit, onRefreshMemory })

  return {
    workspace,
    workspaces,
    workspaceAuthorized,
    initializeWorkspaces,
    setWorkspaceForSession,
    selectWorkspace,
    chooseSavedWorkspace,
    openWorkspaceTool,
    favoriteWorkspace,
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Conversation, Workspace, WorkspaceChangeEvent } from '../../types'
import { errorMessage } from '../../shared/format'
import { useI18n } from '../../shared/i18n'

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

export function affectsWorkspaceContext(event: WorkspaceChangeEvent) {
  return event.overflow || event.paths.some((changedPath) => /^\.nocturne\/(?:memory\.md|rules\.md|project\.json)$/i.test(changedPath))
}

export function useWorkspaceSession({ conversations, activeConversation, isInteractionLocked, onError, onOpenConversation, onClearConversation, onRefreshGit, onRefreshMemory, onNotify }: WorkspaceSessionOptions) {
  const { t } = useI18n()
  const [workspace, setWorkspace] = useState('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const callbacksRef = useRef({ onError, onRefreshGit, onRefreshMemory, onNotify })
  const activeConversationRef = useRef(activeConversation)
  callbacksRef.current = { onError, onRefreshGit, onRefreshMemory, onNotify }
  activeConversationRef.current = activeConversation

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
      callbacksRef.current.onError(t('common.waitBeforeSwitch'))
      return null
    }
    const selected = await window.nocturne.workspace.select()
    if (!selected) return null
    setWorkspace(selected)
    setWorkspaces(await window.nocturne.workspace.list())
    return selected
  }, [isInteractionLocked, t])

  const chooseSavedWorkspace = useCallback(async (selected: string) => {
    if (isInteractionLocked()) {
      callbacksRef.current.onError(t('common.waitBeforeSwitch'))
      return
    }
    setWorkspace(selected)
    const conversation = conversations.find((item) => item.workspace === selected)
    if (conversation) await onOpenConversation(conversation.id)
    else onClearConversation()
  }, [conversations, isInteractionLocked, onClearConversation, onOpenConversation, t])

  const openWorkspaceTool = useCallback(async (tool: 'editor' | 'terminal') => {
    const pathLabel = activeConversation?.workspace || workspace
    if (!pathLabel) return
    try {
      await window.nocturne.workspace.openTool(pathLabel, tool)
      callbacksRef.current.onNotify(tool === 'editor' ? t('common.openWorkspace') : t('common.openTerminal'))
    } catch (error) {
      callbacksRef.current.onError(errorMessage(error))
    }
  }, [activeConversation?.workspace, t, workspace])

  const favoriteWorkspace = useCallback(async (item: Workspace) => {
    try {
      await window.nocturne.workspace.favorite(item.path, !item.favorite)
      setWorkspaces(await window.nocturne.workspace.list())
      callbacksRef.current.onNotify(item.favorite ? t('common.favoriteRemoved') : t('common.favoriteAdded'))
    } catch (error) {
      callbacksRef.current.onError(errorMessage(error))
    }
  }, [t])

  useEffect(() => {
    if (!workspace || !workspaceAuthorized) return
    let refreshTimer: number | null = null
    let refreshContext = false

    const flushExternalChanges = () => {
      refreshTimer = null
      const conversation = activeConversationRef.current
      if (!conversation || conversation.workspace !== workspace) return
      void callbacksRef.current.onRefreshGit(conversation.id)
      if (refreshContext) {
        refreshContext = false
        void callbacksRef.current.onRefreshMemory(conversation.id).catch((error) => callbacksRef.current.onError(errorMessage(error)))
      }
    }

    const offChanged = window.nocturne.workspace.onChanged((event) => {
      if (event.workspace !== workspace) return
      if (event.error) {
        callbacksRef.current.onError(event.error)
        return
      }
      refreshContext ||= affectsWorkspaceContext(event)
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(flushExternalChanges, 300)
    })
    void window.nocturne.workspace.watch(workspace).catch((error) => callbacksRef.current.onError(errorMessage(error)))
    return () => {
      offChanged()
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      void window.nocturne.workspace.watch(null).catch(() => undefined)
    }
  }, [workspace, workspaceAuthorized])

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

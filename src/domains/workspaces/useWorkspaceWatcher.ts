import { useCallback, useEffect, useRef } from 'react'
import type { Conversation, WorkspaceChangeEvent } from '../../types'
import { errorMessage } from '../../shared/format'

interface WorkspaceWatcherOptions {
  workspace: string
  workspaceAuthorized: boolean
  activeConversation: Conversation | undefined
  onError(message: string): void
  onRefreshGit(conversationId: string): Promise<void>
  onRefreshMemory(conversationId: string): Promise<void>
}

export function affectsWorkspaceContext(event: WorkspaceChangeEvent) {
  return event.overflow || event.paths.some((changedPath) => /^\.nocturne\/(?:memory\.md|rules\.md|project\.json)$/i.test(changedPath))
}

export function useWorkspaceWatcher({ workspace, workspaceAuthorized, activeConversation, onError, onRefreshGit, onRefreshMemory }: WorkspaceWatcherOptions) {
  const callbacksRef = useRef({ onError, onRefreshGit, onRefreshMemory })
  const activeConversationRef = useRef(activeConversation)
  const watchQueueRef = useRef(Promise.resolve())
  callbacksRef.current = { onError, onRefreshGit, onRefreshMemory }
  activeConversationRef.current = activeConversation

  const enqueueWatch = useCallback((nextWorkspace: string | null, reportErrors: boolean) => {
    const operation = watchQueueRef.current
      .catch(() => undefined)
      .then(() => window.nocturne.workspace.watch(nextWorkspace))
    watchQueueRef.current = operation.catch(() => undefined)
    if (reportErrors) void operation.catch((error) => callbacksRef.current.onError(errorMessage(error)))
    return operation
  }, [])

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
    void enqueueWatch(workspace, true)

    return () => {
      offChanged()
      if (refreshTimer !== null) window.clearTimeout(refreshTimer)
      // Cleanup is intentionally quiet: a replacement watcher may already own
      // the native resource when an old IPC cleanup completes.
      void enqueueWatch(null, false)
    }
  }, [enqueueWatch, workspace, workspaceAuthorized])
}

import { useEffect, useRef } from 'react'
import type { AppSettings, Conversation, Workspace } from '../../types'
import { errorMessage } from '../../shared/format'

interface AppBootstrapOptions {
  onSetConversations(value: Conversation[]): void
  onInitializeConversationHasMore(value: boolean): void | Promise<void>
  onInitializeWorkspaces(value: Workspace[]): void
  onInitializeSettings(value: AppSettings): void
  onOpenConversation(id: string, conversations: Conversation[], workspaces: Workspace[]): Promise<void>
  onRecordStartup(): void
  onError(message: string): void
}

/** Loads the initial renderer state once and prevents late bootstrap writes after unmount. */
export function useAppBootstrap(options: AppBootstrapOptions) {
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    let mounted = true

    const load = async () => {
      try {
        const [conversationPage, savedWorkspaces, savedSettings] = await Promise.all([
          window.nocturne.conversations.page(),
          window.nocturne.workspace.list(),
          window.nocturne.settings.get(),
        ])
        if (!mounted) return

        const current = optionsRef.current
        const conversations = conversationPage.items
        current.onSetConversations(conversations)
        void current.onInitializeConversationHasMore(conversationPage.hasMore)
        current.onInitializeWorkspaces(savedWorkspaces)
        current.onInitializeSettings(savedSettings)
        if (conversations[0]) {
          await current.onOpenConversation(conversations[0].id, conversations, savedWorkspaces)
        }
        if (mounted) current.onRecordStartup()
      } catch (error) {
        if (mounted) optionsRef.current.onError(errorMessage(error))
      }
    }

    void load()
    return () => { mounted = false }
  }, [])
}

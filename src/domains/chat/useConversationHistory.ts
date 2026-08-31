import { useCallback, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import type { MessagePage } from '../../types'
import { errorMessage } from '../../shared/format'
import { RENDERER_LIMITS } from '../../../shared/constants'
import { useAppStore } from '../../store'

interface ConversationHistoryOptions {
  onError(message: string): void
  onNewContent(value: boolean): void
  chatScrollRef: RefObject<HTMLElement | null>
  stickToBottomRef: MutableRefObject<boolean>
}

export interface ConversationHistory {
  historyHasMore: boolean
  historyHasNewer: boolean
  historyLoading: boolean
  initializeHistory(page: MessagePage): void
  loadOlderMessages(): Promise<void>
  loadLatestMessages(): Promise<void>
  resetHistory(): void
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

export function useConversationHistory({ onError, onNewContent, chatScrollRef, stickToBottomRef }: ConversationHistoryOptions): ConversationHistory {
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [historyHasNewer, setHistoryHasNewer] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const historyOffsetRef = useRef(0)

  const resetHistory = useCallback(() => {
    historyOffsetRef.current = 0
    setHistoryHasMore(false)
    setHistoryHasNewer(false)
    setHistoryLoading(false)
  }, [])

  const initializeHistory = useCallback((page: MessagePage) => {
    historyOffsetRef.current = page.items.length
    setHistoryHasMore(page.hasMore)
    setHistoryHasNewer(false)
    setHistoryLoading(false)
  }, [])

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
      initializeHistory(page)
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
  }, [chatScrollRef, historyLoading, initializeHistory, onError, onNewContent, stickToBottomRef])

  return { historyHasMore, historyHasNewer, historyLoading, initializeHistory, loadOlderMessages, loadLatestMessages, resetHistory }
}

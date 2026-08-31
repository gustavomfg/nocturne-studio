import { useCallback, useEffect, type MutableRefObject, type RefObject } from 'react'
import type { Message } from '../../types'

interface ChatViewportOptions {
  messages: Message[]
  historyHasNewer: boolean
  loadLatestMessages(): Promise<void>
  onNewContent(value: boolean): void
  chatScrollRef: RefObject<HTMLElement | null>
  stickToBottomRef: MutableRefObject<boolean>
}

export function useChatViewport({ messages, historyHasNewer, loadLatestMessages, onNewContent, chatScrollRef, stickToBottomRef }: ChatViewportOptions) {
  const handleChatScroll = useCallback(() => {
    const scroller = chatScrollRef.current
    if (!scroller) return
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 96
    stickToBottomRef.current = atBottom
    if (atBottom) onNewContent(false)
  }, [chatScrollRef, onNewContent, stickToBottomRef])

  const jumpToLatest = useCallback(() => {
    if (historyHasNewer) {
      void loadLatestMessages()
      return
    }
    const scroller = chatScrollRef.current
    if (!scroller) return
    stickToBottomRef.current = true
    onNewContent(false)
    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }, [chatScrollRef, historyHasNewer, loadLatestMessages, onNewContent, stickToBottomRef])

  useEffect(() => {
    const scroller = chatScrollRef.current
    if (!scroller || !stickToBottomRef.current) return
    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
    onNewContent(false)
  }, [chatScrollRef, messages, onNewContent, stickToBottomRef])

  return { handleChatScroll, jumpToLatest }
}

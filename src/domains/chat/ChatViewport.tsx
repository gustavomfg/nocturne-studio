import { useEffect, type MutableRefObject, type RefObject } from 'react'
import { AlertTriangle, ArrowDown, RotateCcw, X } from 'lucide-react'
import type { Message } from '../../types'
import { useAppStore } from '../../store'
import { AssistantMessage, MessageBubble, Welcome } from './ChatContent'
import { explainProductError } from '../../shared/productError'
import { useI18n } from '../../shared/i18n'

const dayKey = (value: string, locale: string) => new Date(value).toLocaleDateString(locale)
const dayLabel = (value: string, language: 'pt-BR' | 'en') => {
  const date = new Date(value)
  const today = new Date()
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return language === 'en' ? 'Today' : 'Hoje'
  if (date.toDateString() === yesterday.toDateString()) return language === 'en' ? 'Yesterday' : 'Ontem'
  return new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'pt-BR', { day: '2-digit', month: 'long', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' }).format(date)
}

interface ChatViewportProps {
  active: boolean
  messages: Message[]
  error: string | null
  historyHasMore: boolean
  historyHasNewer: boolean
  historyLoading: boolean
  newContent: boolean
  chatScrollRef: RefObject<HTMLElement | null>
  endRef: RefObject<HTMLDivElement | null>
  stickToBottomRef: MutableRefObject<boolean>
  onNew(): void
  onWorkspace(): void
  onPrompt(prompt: string): void
  onLoadOlder(): void
  onLoadLatest(): void
  onScroll(): void
  onNewContent(value: boolean): void
  onDismissError(): void
  onRetryError?(): void
  onJumpLatest(): void
}

function StreamingResponse({ chatScrollRef, stickToBottomRef, onNewContent }: Pick<ChatViewportProps, 'chatScrollRef' | 'stickToBottomRef' | 'onNewContent'>) {
  const streaming = useAppStore((state) => state.streaming)
  useEffect(() => {
    const scroller = chatScrollRef.current
    if (!scroller || !streaming) return
    if (stickToBottomRef.current) {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' })
      onNewContent(false)
    } else onNewContent(true)
  }, [chatScrollRef, onNewContent, stickToBottomRef, streaming])
  return streaming ? <AssistantMessage content={streaming} streaming/> : null
}

export function ChatViewport({ active, messages, error, historyHasMore, historyHasNewer, historyLoading, newContent, chatScrollRef, endRef, stickToBottomRef, onNew, onWorkspace, onPrompt, onLoadOlder, onLoadLatest, onScroll, onNewContent, onDismissError, onRetryError, onJumpLatest }: ChatViewportProps) {
  const { language, t } = useI18n()
  const errorDetails = error ? explainProductError(error, language) : null
  const errorCard = errorDetails && <div className="error-card" role="alert" aria-live="assertive"><AlertTriangle size={18}/><div><strong>{errorDetails.title}</strong><p>{errorDetails.cause}</p><small><b>{t('error.preserved')}:</b> {errorDetails.preserved}</small><small><b>{t('error.resolution')}:</b> {errorDetails.resolution}</small></div><span>{onRetryError && errorDetails.retryable && <button onClick={onRetryError}><RotateCcw size={13}/>{t('error.retry')}</button>}<button onClick={onDismissError}><X size={13}/>{t('common.close')}</button></span></div>
  return <>
    <section ref={chatScrollRef} className="chat-scroll" aria-label={t('chat.history')} onScroll={onScroll}>
      {!active && !messages.length ? <div className="chat-content welcome-content"><Welcome onNew={onNew} onWorkspace={onWorkspace} onPrompt={onPrompt}/>{errorCard}</div> : <div className="chat-content">
        {historyHasMore && <button className="load-history" disabled={historyLoading} onClick={onLoadOlder}>{historyLoading ? t('common.loading') : t('chat.loadOlder')}</button>}
        {messages.map((message, index) => <div className="message-entry" data-message-id={message.id} key={message.id}>{(index === 0 || dayKey(messages[index - 1].createdAt, language === 'en' ? 'en-US' : 'pt-BR') !== dayKey(message.createdAt, language === 'en' ? 'en-US' : 'pt-BR')) && <div className="date-divider"><span>{dayLabel(message.createdAt, language)}</span></div>}<MessageBubble message={message}/></div>)}
        {historyHasNewer && <button className="load-history" onClick={onLoadLatest}>{t('chat.backToLatest')}</button>}
        <StreamingResponse chatScrollRef={chatScrollRef} stickToBottomRef={stickToBottomRef} onNewContent={onNewContent}/>
        {errorCard}
        <div ref={endRef}/>
      </div>}
    </section>
    {newContent && <button className="jump-latest" onClick={onJumpLatest}><ArrowDown size={15}/><span>{t('chat.newResponse')}</span></button>}
  </>
}

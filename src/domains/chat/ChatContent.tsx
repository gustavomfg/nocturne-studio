import { memo } from 'react'
import { Brain, Code2, FileCode2, FolderOpen, GitBranch, MessageSquarePlus, Paperclip, Sparkles } from 'lucide-react'
import type { Message } from '../../types'
import { SafeMarkdown } from '../../shared/SafeMarkdown'
import { parseAwarenessSnapshot } from '../../../shared/awareness'
import { useI18n } from '../../shared/i18n'

export function Welcome({ onNew, onWorkspace, onPrompt }: { onNew(): void; onWorkspace(): void; onPrompt(prompt: string): void }) {
  const { t } = useI18n()
  return <div className="welcome"><div className="welcome-orb"><Sparkles size={30}/></div><h2>{t('welcome.title')}</h2><p>{t('welcome.subtitle')}</p><div className="welcome-actions"><button onClick={onWorkspace}><FolderOpen size={17}/>{t('welcome.openProject')}</button><button onClick={onNew}><MessageSquarePlus size={17}/>{t('nav.newConversation')}</button></div><div className="suggestions" aria-label={t('composer.quickActions')}><button onClick={() => onPrompt(t('quick.analyze'))}><Code2/><span><strong>{t('welcome.analyzeProject')}</strong><small>{t('welcome.analyzeProjectHint')}</small></span></button><button onClick={() => onPrompt(t('quick.documentation'))}><FileCode2/><span><strong>{t('welcome.createDocumentation')}</strong><small>{t('welcome.createDocumentationHint')}</small></span></button><button onClick={() => onPrompt(t('quick.review'))}><GitBranch/><span><strong>{t('welcome.reviewChanges')}</strong><small>{t('welcome.reviewChangesHint')}</small></span></button></div></div>
}

export const MessageBubble = memo(function MessageBubble({ message }: { message: Message }) {
  const { t } = useI18n()
  if (message.role !== 'user') return <AssistantMessage content={message.content}/>
  let attachments: string[] = []
  try { attachments = JSON.parse(message.metadata || '{}').attachments || [] } catch { attachments = [] }
  const awareness = parseAwarenessSnapshot(message.metadata)
  return <div className="user-row"><div className="user-message">{message.content}{!!attachments.length && <div className="message-attachments">{attachments.map((filePath) => <span key={filePath}><Paperclip size={10}/>{filePath.split(/[/\\]/).pop()}</span>)}</div>}{awareness && <details className="message-awareness"><summary><Brain size={12}/>{t('chat.usedContext')} · {awareness.selections.length}</summary><div>{awareness.selections.length ? awareness.selections.map((selection) => <p key={`${selection.source}-${selection.id}`}><strong>{selection.title} · {selection.relevance}%</strong><small>{selection.reason}</small></p>) : <p><small>{t('chat.noRelevantMemory')}</small></p>}</div></details>}</div><div className="mini-avatar">G</div></div>
})

export function AssistantMessage({ content, streaming }: { content: string; streaming?: boolean }) {
  const { t } = useI18n()
  const renderAsText = Boolean(streaming) || content.length > 300_000
  return <div className="assistant-row"><div className="assistant-avatar"><Sparkles size={15}/></div><div className="assistant-content"><div className="assistant-name">Nocturne Studio {streaming && <span>{t('chat.writing')}</span>}</div>{renderAsText ? <>{!streaming && <p>{t('chat.longResponse')}</p>}<pre className={`large-response${streaming ? ' streaming-response' : ''}`}>{streaming ? content : content.slice(-300_000)}</pre></> : <SafeMarkdown>{content}</SafeMarkdown>}{streaming && <span className="caret"/>}</div></div>
}

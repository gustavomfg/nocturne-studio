import path from 'node:path'
import type { AgentMode } from '../../shared/suggestions'
import { extractBrainMemoryCandidates, extractSuggestions, reviewComparisonMarkdown } from '../../shared/suggestions'
import { PERSISTENCE_LIMITS } from '../../shared/constants'
import { isJsonValueWithinLimit } from '../../shared/json'
import type { LocalDatabase, MessageRow } from '../database/Database'

export interface CompletedTurnSnapshot {
  conversationId: string
  workspace: string
  mode: AgentMode
  content: string
  diff: string
  files: string[]
  plan: unknown[]
  planExplanation: string
}

export interface PersistedTurn {
  message: MessageRow | null
  warning?: string
}

export function persistCompletedTurn(database: LocalDatabase, snapshot: CompletedTurnSnapshot): PersistedTurn {
  if (!snapshot.content) return { message: null }
  const warnings: string[] = []
  let assistantContent = snapshot.content.slice(0, PERSISTENCE_LIMITS.assistantCharacters)
  const files = [...new Set(snapshot.files)].slice(-300)
  const metadata = {
    diff: snapshot.diff.slice(-PERSISTENCE_LIMITS.metadataCharacters),
    files: files.map((filePath) => ({ path: filePath, kind: 'modified' })),
    plan: snapshot.plan.slice(-100),
    planExplanation: snapshot.planExplanation.slice(-20_000),
  }
  if (!isJsonValueWithinLimit(metadata, PERSISTENCE_LIMITS.metadataCharacters)) {
    return { message: null, warning: 'A resposta excedeu o limite de metadata persistível e não foi salva.' }
  }

  const memoryExtraction = extractBrainMemoryCandidates(assistantContent)
  try {
    database.createBrainMemoryCandidates(snapshot.workspace, snapshot.conversationId, memoryExtraction.candidates)
    assistantContent = memoryExtraction.content || (memoryExtraction.candidates.length ? `${memoryExtraction.candidates.length} candidata(s) foram enviadas ao Segundo Cérebro para sua revisão.` : 'A resposta do agente não continha conteúdo persistível.')
  } catch {
    warnings.push('As candidatas do Segundo Cérebro não puderam ser salvas.')
  }

  if (snapshot.mode === 'review') {
    const suggestionExtraction = extractSuggestions(assistantContent)
    try {
      if (suggestionExtraction.structured) {
        const reconciliation = database.reconcileSuggestions(snapshot.conversationId, snapshot.workspace, suggestionExtraction.suggestions)
        assistantContent = [suggestionExtraction.content, reviewComparisonMarkdown(reconciliation.comparison)].filter(Boolean).join('\n\n')
      } else {
        assistantContent = suggestionExtraction.content || assistantContent
        warnings.push('A resposta não trouxe um snapshot estruturado; sugestões anteriores foram preservadas.')
      }
    } catch {
      warnings.push('As sugestões da análise não puderam ser salvas.')
    }
  }

  const artifacts: Array<{ type: string; title: string; filePath?: string; content?: string }> = files.map((filePath) => ({ type: artifactType(filePath), title: path.basename(filePath), filePath }))
  if (snapshot.diff) artifacts.push({ type: 'report', title: 'Alterações do turno', filePath: undefined, content: snapshot.diff.slice(-PERSISTENCE_LIMITS.metadataCharacters) })
  const message = database.saveAssistantTurn(snapshot.conversationId, snapshot.workspace, assistantContent, metadata, artifacts)
  return { message, ...(warnings.length ? { warning: warnings.join(' ') } : {}) }
}

function artifactType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(extension)) return 'image'
  if (extension === '.md') return 'markdown'
  if (['.json', '.yaml', '.yml', '.toml', '.env', '.ini'].includes(extension)) return 'configuration'
  if (['.docx', '.pdf', '.html'].includes(extension)) return 'document'
  return 'code'
}

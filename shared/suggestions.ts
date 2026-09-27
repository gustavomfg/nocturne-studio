import { z } from 'zod'
import { brainMemoryKinds, brainMemoryScopes, isSafeBrainMemoryContent, type BrainMemoryCandidate } from './brainMemory'

export const suggestionCategories = ['architecture', 'security', 'performance', 'bug', 'cleanup', 'testing', 'documentation', 'dependency', 'accessibility'] as const
export const suggestionSeverities = ['info', 'low', 'medium', 'high', 'critical'] as const
export const suggestionStatuses = ['new', 'in-analysis', 'accepted', 'rejected', 'resolved', 'deferred', 'invalid'] as const
export const agentModes = ['build', 'review', 'docs'] as const
export type SuggestionCategory = typeof suggestionCategories[number]
export type SuggestionSeverity = typeof suggestionSeverities[number]
export type SuggestionStatus = typeof suggestionStatuses[number]
export type AgentMode = typeof agentModes[number]
export interface SuggestionEvidence {
  source: string
  detail: string
  location?: string
}
export interface SuggestionHistoryEntry {
  id: string
  status: SuggestionStatus
  result: string | null
  createdAt: string
}
export interface ReviewComparisonItem {
  id: string
  title: string
  severity: SuggestionSeverity
}
export interface ReviewSeverityChange {
  id: string
  title: string
  from: SuggestionSeverity
  to: SuggestionSeverity
}
export interface ReviewComparison {
  reviewedAt: string
  newSuggestions: ReviewComparisonItem[]
  persistentSuggestions: ReviewComparisonItem[]
  resolvedSuggestions: ReviewComparisonItem[]
  severityChanges: ReviewSeverityChange[]
}
export interface SuggestionReconciliation {
  suggestions: Suggestion[]
  comparison: ReviewComparison
}

export interface Suggestion {
  id: string; workspaceId: string; conversationId: string; title: string; description: string; reasoning: string
  category: SuggestionCategory; severity: SuggestionSeverity; affectedFiles: string[]; proposedChanges: string; expectedBenefits: string[]; complexity: 'low' | 'medium' | 'high'; risk: 'low' | 'medium' | 'high'
  evidence: SuggestionEvidence[]; confidence: number; source: string; responsible: string
  createdAt: string; updatedAt: string; status: SuggestionStatus; history: SuggestionHistoryEntry[]
}
export type SuggestionInput = Omit<Suggestion, 'id' | 'workspaceId' | 'conversationId' | 'createdAt' | 'updatedAt' | 'status' | 'history' | 'evidence' | 'confidence' | 'source' | 'responsible'> & {
  evidence?: SuggestionEvidence[]
  confidence?: number
  source?: string
  responsible?: string
}

export function sanitizeSuggestionTitle(value: string) {
  return value.replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim()
}

export function suggestionIdentity(value: Pick<SuggestionInput, 'category' | 'title'>) {
  const title = sanitizeSuggestionTitle(value.title).normalize('NFKD').replace(/\p{M}+/gu, '').toLocaleLowerCase('pt-BR')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return `${value.category}:${title}`
}

export const suggestionInputSchema = z.object({
  title: z.string().max(200).transform(sanitizeSuggestionTitle).pipe(z.string().min(1).max(200)), description: z.string().trim().min(1).max(10_000), reasoning: z.string().trim().min(1).max(10_000),
  category: z.enum(suggestionCategories), severity: z.enum(suggestionSeverities), affectedFiles: z.array(z.string().trim().min(1).max(1_000)).max(100).default([]), proposedChanges: z.string().max(100_000).default(''), expectedBenefits: z.array(z.string().trim().min(1).max(1_000)).max(20).default([]), complexity: z.enum(['low', 'medium', 'high']).default('medium'), risk: z.enum(['low', 'medium', 'high']).default('medium'),
  evidence: z.array(z.object({
    source: z.string().trim().min(1).max(500),
    detail: z.string().trim().min(1).max(4_000),
    location: z.string().trim().min(1).max(1_000).optional(),
  }).strict()).max(50).default([]),
  confidence: z.number().int().min(0).max(100).default(60),
  source: z.string().trim().min(1).max(500).default('Análise do agente'),
  responsible: z.string().trim().min(1).max(500).default('Agente de revisão'),
})

const blockPattern = /```nocturne-suggestions\s*\n([\s\S]*?)```/gi
const trailingJsonBlockPattern = /```json\s*\n([\s\S]*?)```\s*$/i
export function extractSuggestions(content: string) {
  const markerCount = content.match(/```nocturne-suggestions\b/gi)?.length ?? 0
  const blocks = [...content.matchAll(blockPattern)]
  blockPattern.lastIndex = 0
  if (markerCount) {
    const suggestions = markerCount === 1 && blocks.length === 1 ? parseStrictSuggestionArray(blocks[0][1]) : null
    if (suggestions) return { suggestions, content: content.replace(blockPattern, '').trim(), structured: true, snapshot: 'valid' as const }
    return { suggestions: [], content: content.trim(), structured: false, snapshot: 'invalid' as const }
  }

  const fallback = trailingJsonBlockPattern.exec(content)
  const recovered = fallback ? parseStrictSuggestionArray(fallback[1]) : null
  if (fallback && recovered) {
    return {
      suggestions: recovered,
      content: content.slice(0, fallback.index).trim(),
      structured: true,
      snapshot: 'valid' as const,
    }
  }
  return { suggestions: [], content: content.trim(), structured: false, snapshot: fallback ? 'invalid' as const : 'absent' as const }
}

function parseStrictSuggestionArray(value: string): z.infer<typeof suggestionInputSchema>[] | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return null
    const suggestions: z.infer<typeof suggestionInputSchema>[] = []
    for (const item of parsed) {
      const result = suggestionInputSchema.safeParse(item)
      if (!result.success) return null
      suggestions.push(result.data)
    }
    return suggestions
  } catch {
    return null
  }
}

export function reviewInstructions() {
  return `Você está no Review Mode do Nocturne Studio. Analise o estado atual e proponha; não altere arquivos, não instale dependências e não execute comandos que modifiquem o workspace. Use somente leitura. Toda melhoria concreta ainda presente deve ser publicada ao final em um único bloco JSON válido. Mesmo quando não houver sugestões, publique o bloco com [] para confirmar que a revisão estruturada terminou. Separe evidência observável de justificativa e calibre a confiança de 0 a 100:\n\n\`\`\`nocturne-suggestions\n[{"title":"...","description":"problema e impacto","reasoning":"justificativa da conclusão","evidence":[{"source":"arquivo|git|teste|comando somente leitura|documentação","detail":"o que foi observado","location":"caminho:linha opcional"}],"confidence":85,"source":"origem da análise","responsible":"agente ou pessoa responsável pela análise","category":"architecture|security|performance|bug|cleanup|testing|documentation|dependency|accessibility","severity":"info|low|medium|high|critical","affectedFiles":["caminho/relativo"],"proposedChanges":"diff ou descrição precisa da solução","expectedBenefits":["benefício verificável"],"complexity":"low|medium|high","risk":"low|medium|high"}]\n\`\`\`\n\nNão aplique as propostas. O usuário decidirá separadamente.`
}

export function reviewComparisonMarkdown(comparison: ReviewComparison) {
  const severityChanges = comparison.severityChanges.length
    ? comparison.severityChanges.map((item) => `${item.title}: ${item.from} → ${item.to}`).join('; ')
    : 'nenhuma'
  return `### Comparação com a revisão anterior

- Novas: ${comparison.newSuggestions.length}
- Persistentes: ${comparison.persistentSuggestions.length}
- Resolvidas nesta revisão: ${comparison.resolvedSuggestions.length}
- Mudanças de severidade: ${severityChanges}`
}
const memoryBlockPattern = /```nocturne-memories\s*\n([\s\S]*?)```/gi
const memoryCandidateSchema = z.object({ kind: z.enum(brainMemoryKinds), scope: z.enum(brainMemoryScopes), content: z.string().trim().min(1).max(8_000).refine(isSafeBrainMemoryContent, 'A memória parece conter uma credencial.'), confidence: z.number().int().min(0).max(100).default(60) }).strict()

export function extractBrainMemoryCandidates(content: string) {
  const candidates: BrainMemoryCandidate[] = []
  let match: RegExpExecArray | null
  memoryBlockPattern.lastIndex = 0
  while ((match = memoryBlockPattern.exec(content)) !== null && candidates.length < 5) {
    try {
      const parsed: unknown = JSON.parse(match[1])
      for (const value of Array.isArray(parsed) ? parsed : [parsed]) {
        const result = memoryCandidateSchema.safeParse(value)
        if (result.success && candidates.length < 5) candidates.push(result.data)
      }
    } catch { /* bloco incompleto é ignorado */ }
  }
  memoryBlockPattern.lastIndex = 0
  return { candidates, content: content.replace(memoryBlockPattern, '').trim() }
}

export function brainMemoryCandidateInstructions() {
  return `Se este turno revelar uma decisão, preferência, restrição, fato estável ou aprendizado realmente útil em trabalhos futuros, você pode propor até cinco lembranças ao final em um único bloco JSON válido. Não inclua credenciais, tokens, conteúdo integral de arquivos, estado transitório, suposições ou informações já presentes no contexto. O bloco é opcional; omita-o quando não houver conhecimento durável. Toda entrada será apenas candidata e dependerá de aprovação do usuário:\n\n\`\`\`nocturne-memories\n[{"kind":"fact|decision|preference|constraint|learning","scope":"workspace|conversation","content":"...","confidence":60}]\n\`\`\``
}
export function agentModeInstructions(mode: AgentMode) {
  const modeInstructions = mode === 'review' ? reviewInstructions()
    : mode === 'docs' ? 'Você está no Docs Mode do Nocturne Studio neste turno. Inspecione em somente leitura a documentação relacionada ao pedido e produza o conteúdo Markdown proposto na resposta. Não altere arquivos diretamente: o usuário comparará o documento atual com a proposta e decidirá separadamente se deseja criar, anexar ou substituir. Prefira atualizações incrementais e focadas. Valide links, comandos e exemplos quando possível.'
      : 'Você está no Build Mode do Nocturne Studio neste turno. Restrições de Review Mode de turnos anteriores estão desativadas. Você pode modificar o workspace e executar validações conforme o pedido, sempre respeitando o sandbox e as aprovações atuais. Implemente a alteração solicitada em vez de apenas propor uma sugestão.'
  return `${modeInstructions}\n\n${brainMemoryCandidateInstructions()}`
}
export function sandboxModeForAgent(mode: AgentMode, configured: 'read-only' | 'workspace-write') { return mode === 'review' || mode === 'docs' ? 'read-only' : configured }

export function suggestedCommit(suggestion: Pick<Suggestion, 'category' | 'title'>) {
  const type = suggestion.category === 'architecture' ? 'refactor' : suggestion.category === 'documentation' ? 'docs' : suggestion.category === 'testing' ? 'test' : suggestion.category === 'cleanup' ? 'chore' : 'fix'
  return `${type}(${suggestion.category}): ${suggestion.title.toLowerCase()}`.slice(0, 100)
}

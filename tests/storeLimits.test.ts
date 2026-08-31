import { beforeEach, describe, expect, it } from 'vitest'
import { selectPendingApprovalCount, useAppStore } from '../src/store'
import { PERSISTENCE_LIMITS, RENDERER_PERFORMANCE_BUDGETS } from '../shared/constants'
import { exportDocumentSchema, prepareMarkdownSchema, rendererStatsSchema, saveAssistantSchema, suggestionExtractSchema } from '../shared/ipc/schemas'
import { JSON_VALUE_LIMITS } from '../shared/json'

beforeEach(() => useAppStore.setState({ streaming: '', activities: [], files: [], approvals: [] }))

describe('limites de estabilidade do renderer', () => {
  it('limita o buffer acumulado da resposta', () => {
    useAppStore.getState().appendStream('x'.repeat(2_100_000))
    expect(useAppStore.getState().streaming).toHaveLength(2_000_000)
  })
  it('mantém apenas as atividades recentes e limita detalhes', () => {
    for (let index = 0; index < 350; index += 1) useAppStore.getState().upsertActivity({ id: String(index), type: 'read', label: 'Leitura', detail: 'x'.repeat(70_000), status: 'completed' })
    const activities = useAppStore.getState().activities
    expect(activities).toHaveLength(300)
    expect(activities[0].id).toBe('50')
    expect(activities[activities.length - 1]?.detail).toHaveLength(64_000)
  })
  it('mantém somente os arquivos alterados mais recentes', () => {
    useAppStore.getState().addFiles(Array.from({ length: 350 }, (_, index) => ({ path: `src/file-${index}.ts`, kind: 'modified' as const, status: 'M' })))
    const files = useAppStore.getState().files
    expect(files).toHaveLength(300)
    expect(files[0].path).toBe('src/file-50.ts')
  })
  it('deriva somente a contagem de aprovações pendentes para o composer', () => {
    useAppStore.getState().addApproval({ key: 'pending', kind: 'command', title: 'Executar', detail: 'npm test', status: 'pending' })
    useAppStore.getState().addApproval({ key: 'resolved', kind: 'command', title: 'Executado', detail: 'npm test', status: 'accepted' })
    expect(selectPendingApprovalCount(useAppStore.getState())).toBe(1)
    useAppStore.getState().resolveApproval('pending', 'declined')
    expect(selectPendingApprovalCount(useAppStore.getState())).toBe(0)
  })
})

describe('limites de persistência IPC', () => {
  const conversationId = '00000000-0000-4000-8000-000000000001'
  it('aceita conteúdo exatamente no limite', () => {
    expect(saveAssistantSchema.safeParse({ conversationId, content: 'x'.repeat(PERSISTENCE_LIMITS.assistantCharacters) }).success).toBe(true)
    expect(suggestionExtractSchema.safeParse({ conversationId, content: 'x'.repeat(PERSISTENCE_LIMITS.assistantCharacters) }).success).toBe(true)
    expect(prepareMarkdownSchema.safeParse({ conversationId, content: 'x'.repeat(PERSISTENCE_LIMITS.documentCharacters), name: 'a'.repeat(PERSISTENCE_LIMITS.documentNameCharacters) }).success).toBe(true)
  })
  it('rejeita conteúdo e nome imediatamente acima do limite', () => {
    expect(saveAssistantSchema.safeParse({ conversationId, content: 'x'.repeat(PERSISTENCE_LIMITS.assistantCharacters + 1) }).success).toBe(false)
    expect(suggestionExtractSchema.safeParse({ conversationId, content: 'x'.repeat(PERSISTENCE_LIMITS.assistantCharacters + 1) }).success).toBe(false)
    expect(exportDocumentSchema.safeParse({ conversationId, content: 'x'.repeat(PERSISTENCE_LIMITS.documentCharacters + 1), format: 'pdf' }).success).toBe(false)
    expect(prepareMarkdownSchema.safeParse({ conversationId, content: '', name: 'a'.repeat(PERSISTENCE_LIMITS.documentNameCharacters + 1) }).success).toBe(false)
  })
  it('aceita metadata JSON legítimo no limite serializado e rejeita o excedente', () => {
    const atLimit = 'x'.repeat(PERSISTENCE_LIMITS.metadataCharacters - 2)
    expect(saveAssistantSchema.safeParse({ conversationId, content: 'Resposta', metadata: atLimit }).success).toBe(true)
    expect(saveAssistantSchema.safeParse({ conversationId, content: 'Resposta', metadata: `${atLimit}x` }).success).toBe(false)
    expect(saveAssistantSchema.safeParse({ conversationId, content: 'Resposta', metadata: { files: [{ path: 'src/App.tsx', kind: 'modified' }], plan: [{ step: 'validar' }], optional: null } }).success).toBe(true)
  })
  it('rejeita valores JavaScript que JSON.stringify converteria ou não suportaria', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(saveAssistantSchema.safeParse({ conversationId, content: 'Resposta', metadata: cyclic }).success).toBe(false)
    expect(saveAssistantSchema.safeParse({ conversationId, content: 'Resposta', metadata: { missing: undefined } }).success).toBe(false)
    expect(saveAssistantSchema.safeParse({ conversationId, content: 'Resposta', metadata: { unsupported: 1n } }).success).toBe(false)
    expect(saveAssistantSchema.safeParse({ conversationId, content: 'Resposta', metadata: { unsupported: () => undefined } }).success).toBe(false)
    expect(saveAssistantSchema.safeParse({ conversationId, content: 'Resposta', metadata: { unsupported: Number.NaN } }).success).toBe(false)
  })
  it('limita profundidade para manter a validação previsível', () => {
    let deep: unknown = 'leaf'
    for (let index = 0; index <= JSON_VALUE_LIMITS.maxDepth; index += 1) deep = { value: deep }
    expect(saveAssistantSchema.safeParse({ conversationId, content: 'Resposta', metadata: deep }).success).toBe(false)
  })
})

describe('métricas internas de desempenho', () => {
  const metrics = {
    responseSize: 2_000,
    activities: 12,
    messages: 80,
    renderCounts: { app: 4, chat: 3, composer: 5, agentPanel: 2, agentActivity: 8 },
    startupMs: RENDERER_PERFORMANCE_BUDGETS.startupMs,
    conversationLoadMs: RENDERER_PERFORMANCE_BUDGETS.conversationLoadMs,
    longTasks: 1,
    longTaskDurationMs: RENDERER_PERFORMANCE_BUDGETS.longTaskMs,
    longestLongTaskMs: RENDERER_PERFORMANCE_BUDGETS.longTaskMs,
  }

  it('aceita apenas agregados numéricos limitados', () => {
    expect(rendererStatsSchema.parse(metrics)).toEqual(metrics)
    expect(rendererStatsSchema.safeParse({ ...metrics, prompt: 'conteúdo privado' }).success).toBe(false)
  })

  it('rejeita métricas negativas ou fora dos limites', () => {
    expect(rendererStatsSchema.safeParse({ ...metrics, startupMs: -1 }).success).toBe(false)
    expect(rendererStatsSchema.safeParse({ ...metrics, responseSize: 10_000_001 }).success).toBe(false)
  })
})

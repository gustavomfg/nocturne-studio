import type { Page } from '@playwright/test'
import type { ValidationKind } from '../../shared/codeIntelligence'

export async function installNocturneMock(page: Page, options: { empty?: boolean; unauthorized?: boolean; moved?: boolean; signedOut?: boolean; messageCount?: number; firstRun?: boolean } = {}) {
  await page.addInitScript(({ empty, unauthorized, moved, signedOut, messageCount, firstRun }) => {
    if (firstRun) localStorage.removeItem('nocturne.onboarding.completed')
    else localStorage.setItem('nocturne.onboarding.completed', 'true')
    const now = '2026-07-13T20:00:00.000Z'
    const workspace = '/workspace/sample-project'
    const conversation = { id: 'conversation-1', title: 'Lapidação da experiência', workspace, createdAt: now, updatedAt: now }
    const eventListeners: Array<(payload: unknown) => void> = []
    const statusListeners: Array<(payload: unknown) => void> = []
    const workspaceChangeListeners: Array<(payload: unknown) => void> = []
    const projectIndexStatusListeners: Array<(payload: unknown) => void> = []
    const validationStatusListeners: Array<(payload: unknown) => void> = []
    let authorized = !unauthorized && !moved
    let unavailable = Boolean(moved)
    let selectedWorkspace = workspace
    let selectedExpected: string | undefined
    let memoryReads = 0
    const rendererPerformanceReports: unknown[] = []
    type MockBrainMemory = { id: string; workspaceId: string; conversationId: string | null; kind: 'fact' | 'decision' | 'preference' | 'constraint' | 'learning'; scope: 'workspace' | 'conversation'; status: 'candidate' | 'active' | 'outdated' | 'archived'; content: string; confidence: number; sourceType: 'manual' | 'agent'; sourceId: string | null; createdAt: string; updatedAt: string; lastConfirmedAt: string | null; lastUsedAt: string | null; useCount: number }
    type MockProviderConfiguration = { id: string; providerType: 'openai-compatible'; displayName: string; source: 'local' | 'remote'; baseUrl: string; enabled: boolean; requiresAuthentication: boolean; credentialConfigured: boolean; timeoutMs: number; createdAt: string; updatedAt: string }
    type MockModelReference = { providerId: string; modelId: string }
    type MockModelBindings = { workspaceId: string; defaultBinding?: MockModelReference }
    let brainMemories: MockBrainMemory[] = []
    let providerConfigurations: MockProviderConfiguration[] = []
    const messages = empty ? [] : messageCount ? Array.from({ length: messageCount }, (_, index) => ({
      id: `message-${index + 1}`,
      conversationId: conversation.id,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `Mensagem histórica ${index + 1}`,
      metadata: null,
      createdAt: new Date(Date.parse(now) - (messageCount - index) * 60_000).toISOString(),
    })) : [
      { id: 'message-1', conversationId: conversation.id, role: 'user' as const, content: 'Deixe a experiência mais fluida e previsível.', metadata: null, createdAt: now },
      { id: 'message-2', conversationId: conversation.id, role: 'assistant' as const, content: 'A interface foi analisada. Os fluxos prioritários estão organizados e prontos para validação.', metadata: null, createdAt: now },
    ]
    const modelDescriptors = [
      { providerId: 'openrouter', modelId: 'anthropic/claude-sonnet', displayName: 'Claude Sonnet', family: 'Claude', source: 'remote' as const, capabilities: ['chat', 'streaming', 'reasoning'] as const, contextWindow: 200_000, availability: 'available' as const },
      { providerId: 'ollama', modelId: 'qwen3:14b', displayName: 'Qwen3 14B', family: 'Qwen', source: 'local' as const, capabilities: ['chat', 'tool-calling'] as const, contextWindow: 32_768, availability: 'available' as const },
      { providerId: 'legacy-provider', modelId: 'offline-model', displayName: 'Modelo anterior', source: 'remote' as const, capabilities: ['chat'] as const, availability: 'offline' as const },
    ]
    let modelBindings: MockModelBindings | null = null
    let appSettings = { model: '', sandbox: 'workspace-write' as const, approvalPolicy: 'on-request' as const, theme: 'dark' as 'dark' | 'light', defaultAgentMode: 'review' as const, authenticated: !signedOut, authStatus: signedOut ? 'Login necessário' : 'Autenticado', serverStatus: 'ready' }
    const noop = async () => undefined
    const api = {
      workspace: {
        select: async (expected?: string) => {
          selectedExpected = expected
          if (unavailable) {
            selectedWorkspace = '/workspace/renamed-project'
            conversation.workspace = selectedWorkspace
            unavailable = false
          }
          authorized = true
          return selectedWorkspace
        },
        validate: async () => true,
        list: async () => [{ path: selectedWorkspace, name: selectedWorkspace.split('/').pop(), favorite: true, authorized, availability: unavailable ? 'missing' : 'available', ...(unavailable ? { availabilityMessage: 'Pasta do projeto não encontrada.' } : {}), createdAt: now, lastOpenedAt: now }],
        remove: noop,
        favorite: noop,
        openTool: noop,
        watch: noop,
        onChanged: (listener: (payload: unknown) => void) => { workspaceChangeListeners.push(listener); return () => { const index = workspaceChangeListeners.indexOf(listener); if (index >= 0) workspaceChangeListeners.splice(index, 1) } },
      },
      projectIndex: {
        status: async () => null,
        start: noop,
        cancel: async () => false,
        retry: noop,
        summary: async () => ({ workspace: selectedWorkspace, indexVersion: 1, latestRun: null, files: 0, indexedFiles: 0, failedFiles: 0, unsupportedFiles: 0, symbols: 0, imports: 0, exports: 0, stack: null }),
        files: async () => [],
        symbols: async () => [],
        imports: async () => [],
        exports: async () => [],
        stack: async () => [],
        exclusions: async () => [],
        onStatus: (listener: (payload: unknown) => void) => { projectIndexStatusListeners.push(listener); return () => { const index = projectIndexStatusListeners.indexOf(listener); if (index >= 0) projectIndexStatusListeners.splice(index, 1) } },
      },
      validation: {
        run: async (_workspace: string, kind: ValidationKind) => ({ id: `validation-${kind}`, workspace: selectedWorkspace, kind, command: '', args: [], status: 'blocked' as const, exitCode: null, durationMs: 0, outputSummary: '', artifacts: [], startedAt: now, completedAt: now, error: 'Nenhum comando identificado.' }),
        cancel: async () => false,
        list: async () => [],
        latest: async () => null,
        onStatus: (listener: (payload: unknown) => void) => { validationStatusListeners.push(listener); return () => { const index = validationStatusListeners.indexOf(listener); if (index >= 0) validationStatusListeners.splice(index, 1) } },
      },
      conversations: {
        list: async () => empty ? [] : [conversation],
        page: async () => ({ items: empty ? [] : [conversation], hasMore: false }),
        create: async () => conversation,
        messages: async () => messages.map((message) => ({ ...message })),
        messagePage: async (_id: string, offset = 0, limit = 100) => {
          const end = Math.max(0, messages.length - offset)
          const start = Math.max(0, end - limit)
          return {
            items: messages.slice(start, end).map((message) => ({ ...message })),
            hasMore: start > 0,
          }
        },
        delete: noop,
      },
      ai: {
        send: noop,
        cancel: noop,
        saveAssistant: async (conversationId: string, content: string) => ({ id: 'saved-message', conversationId, role: 'assistant', content, metadata: null, createdAt: now }),
        approve: noop,
        rollbackStatus: async () => ({ available: false, files: [], reason: 'Nenhum Build reversível foi registrado nesta conversa.' }),
        rollback: async () => null,
        onEvent: (listener: (payload: unknown) => void) => { eventListeners.push(listener); return () => { const index = eventListeners.indexOf(listener); if (index >= 0) eventListeners.splice(index, 1) } },
        onStatus: (listener: (payload: unknown) => void) => { statusListeners.push(listener); return () => { const index = statusListeners.indexOf(listener); if (index >= 0) statusListeners.splice(index, 1) } },
      },
      codex: {
        status: async () => ({ installed: true, authenticated: !signedOut, compatible: true, version: '0.145.0', authenticationMethod: 'chatgpt' as const }),
        login: async () => ({ installed: true, authenticated: true, compatible: true, version: '0.145.0', authenticationMethod: 'chatgpt' as const }),
        logout: async () => ({ installed: true, authenticated: false, compatible: true, version: '0.145.0' }),
        models: async () => [
          { model: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', defaultReasoningEffort: 'medium', isDefault: true },
          { model: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna', defaultReasoningEffort: 'low', isDefault: false },
        ],
      },
      files: { attach: async () => [], open: noop, preview: async (_id: string, filePath: string) => ({ kind: 'text', name: filePath.split('/').pop(), filePath, mime: 'text/plain', content: 'conteúdo', size: 8 }) },
      memory: { get: async () => { memoryReads += 1; return { content: '', rules: '', updatedAt: '' } }, set: async (_id: string, content: string, rules: string) => ({ content, rules, updatedAt: now }) },
      brain: {
        page: async (_id: string, offset = 0, limit = 50, query = '', status?: MockBrainMemory['status']) => {
          const normalized = query.toLocaleLowerCase()
          const filtered = brainMemories.filter((item) => (!status || item.status === status) && (!normalized || item.content.toLocaleLowerCase().includes(normalized)))
          return { items: filtered.slice(offset, offset + limit), hasMore: filtered.length > offset + limit }
        },
        history: async (_id: string, memoryId: string) => {
          const memory = brainMemories.find((item) => item.id === memoryId)
          return memory ? [{ id: `history-${memory.id}`, memoryId: memory.id, action: 'created' as const, fromStatus: null, toStatus: memory.status, summary: 'Memória criada manualmente.', createdAt: memory.createdAt }] : []
        },
        create: async (_id: string, value: Pick<MockBrainMemory, 'kind' | 'scope' | 'content'>) => {
          const memory: MockBrainMemory = { id: `brain-${brainMemories.length + 1}`, workspaceId: workspace, conversationId: value.scope === 'conversation' ? conversation.id : null, ...value, status: 'candidate', confidence: 70, sourceType: 'manual', sourceId: null, createdAt: now, updatedAt: now, lastConfirmedAt: null, lastUsedAt: null, useCount: 0 }
          brainMemories = [memory, ...brainMemories]; return memory
        },
        update: async (_id: string, memoryId: string, value: Partial<MockBrainMemory>) => {
          const memory = brainMemories.find((item) => item.id === memoryId); if (!memory) throw new Error('Memória não encontrada.')
          Object.assign(memory, value, { updatedAt: now }); if (value.status === 'active') memory.lastConfirmedAt = now; return memory
        },
        delete: async (_id: string, memoryId: string) => { brainMemories = brainMemories.filter((item) => item.id !== memoryId); return { deleted: true as const } },
        extract: async (_id: string, content: string) => {
          const pattern = /```nocturne-memories\s*\n([\s\S]*?)```/gi
          const created: MockBrainMemory[] = []
          let match: RegExpExecArray | null
          while ((match = pattern.exec(content)) !== null) {
            const values = JSON.parse(match[1]) as Array<Pick<MockBrainMemory, 'kind' | 'scope' | 'content' | 'confidence'>>
            for (const value of values) {
              const memory: MockBrainMemory = { id: `brain-${brainMemories.length + created.length + 1}`, workspaceId: workspace, conversationId: value.scope === 'conversation' ? conversation.id : null, ...value, status: 'candidate', sourceType: 'agent', sourceId: null, createdAt: now, updatedAt: now, lastConfirmedAt: null, lastUsedAt: null, useCount: 0 }
              created.push(memory)
            }
          }
          brainMemories = [...created, ...brainMemories]
          return { memories: created, content: content.replace(pattern, '').trim() }
        },
      },
      artifacts: { list: async () => [], page: async () => ({ items: [], hasMore: false }), delete: noop },
      suggestions: { list: async () => [], page: async () => ({ items: [], hasMore: false }), create: async (_id: string, content: string) => ({ suggestions: [], content }), status: noop },
      data: { export: async () => '/tmp/backup.json', import: async () => true },
      diagnostics: {
        openLogs: noop,
        copy: async () => 'diagnóstico',
        export: async () => '/tmp/nocturne-diagnostic.json',
        rendererError: noop,
        rendererStats: async (value: unknown) => { rendererPerformanceReports.push(structuredClone(value)) },
      },
      settings: {
        get: async () => ({ ...appSettings }),
        check: async () => ({ ...appSettings }),
        set: async (value: Partial<typeof appSettings>) => {
          appSettings = { ...appSettings, ...value }
          return { ...appSettings }
        },
      },
      providers: {
        list: async () => providerConfigurations.map((item) => ({ ...item })),
        create: async (configuration: Omit<MockProviderConfiguration, 'id' | 'credentialConfigured' | 'createdAt' | 'updatedAt'>, credential?: string) => {
          const id = configuration.displayName.toLowerCase().replace(/\s+/g, '-')
          const created = { id, ...configuration, credentialConfigured: Boolean(credential), createdAt: now, updatedAt: now }
          providerConfigurations = [created, ...providerConfigurations]
          return { ...created }
        },
        update: async (id: string, configuration: Omit<MockProviderConfiguration, 'id' | 'credentialConfigured' | 'createdAt' | 'updatedAt'>, options: { credential?: string; clearCredential?: boolean } = {}) => {
          const current = providerConfigurations.find((item) => item.id === id)
          if (!current) throw new Error('Provider não encontrado.')
          const updated = { ...current, ...configuration, credentialConfigured: options.clearCredential ? false : Boolean(options.credential) || current.credentialConfigured, updatedAt: now }
          providerConfigurations = providerConfigurations.map((item) => item.id === id ? updated : item)
          return { ...updated }
        },
        remove: async (id: string) => {
          const previousLength = providerConfigurations.length
          providerConfigurations = providerConfigurations.filter((item) => item.id !== id)
          return providerConfigurations.length < previousLength
        },
        testConnection: async () => ({ status: 'available' as const, message: 'Conexão validada.' }),
        diagnose: async (id: string) => {
          const provider = providerConfigurations.find((item) => item.id === id)
          if (!provider) throw new Error('Provider não encontrado.')
          return {
            providerId: id,
            definition: {
              id,
              displayName: provider.displayName,
              source: provider.source,
              protocol: 'OpenAI-compatible',
              version: 'v1',
              capabilities: { modelDiscovery: true, streaming: true, toolCalling: false, cancellation: true, authentication: provider.requiresAuthentication ? 'required' as const : 'none' as const },
              limitations: { requestTimeoutMs: { minimum: 1_000, maximum: 120_000 }, notes: ['Tool calling ainda não é normalizado por este adapter.'] },
            },
            availability: { status: 'available' as const, checkedAt: now },
            connectivity: 'connected' as const,
            authentication: provider.requiresAuthentication ? 'configured' as const : 'not-required' as const,
            compatibility: 'compatible' as const,
            latencyMs: 42,
            checkedAt: now,
            recentErrors: [],
          }
        },
      },
      models: {
        list: async () => modelDescriptors.map((item) => ({ ...item, capabilities: [...item.capabilities] })),
        refresh: async (providerId: string) => ({ status: 'applied' as const, models: modelDescriptors.filter((item) => item.providerId === providerId) }),
        bindings: async () => modelBindings ? structuredClone(modelBindings) : null,
        setBindings: async (bindings: MockModelBindings) => {
          modelBindings = structuredClone(bindings)
          return structuredClone(bindings)
        },
      },
      git: { status: async () => ({ branch: 'master', status: 'M src/App.tsx', diff: '', files: [{ path: 'src/App.tsx', status: 'M' }] }), commit: noop },
      documents: {
        prepareMarkdown: async () => null,
        applyMarkdown: async () => null,
        export: async () => '/tmp/resposta.pdf',
      },
      clipboard: { readText: async () => '', writeText: noop },
    }
    Object.defineProperty(window, 'nocturne', { configurable: true, value: api })
    Object.defineProperty(window, '__nocturneTest', { configurable: true, value: {
      emitEvent: (payload: unknown) => eventListeners.forEach((listener) => listener(payload)),
      emitStatus: (payload: unknown) => statusListeners.forEach((listener) => listener(payload)),
      emitWorkspaceChange: (payload: unknown) => workspaceChangeListeners.forEach((listener) => listener(payload)),
      emitProjectIndexStatus: (payload: unknown) => projectIndexStatusListeners.forEach((listener) => listener(payload)),
      emitValidationStatus: (payload: unknown) => validationStatusListeners.forEach((listener) => listener(payload)),
      calls: () => ({ selectedExpected, memoryReads }),
      performanceReports: () => structuredClone(rendererPerformanceReports),
    } })
  }, { empty: Boolean(options.empty), unauthorized: Boolean(options.unauthorized), moved: Boolean(options.moved), signedOut: Boolean(options.signedOut), messageCount: options.messageCount ?? 0, firstRun: Boolean(options.firstRun) })
}

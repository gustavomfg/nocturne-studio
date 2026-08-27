import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { NocturneApi } from '../shared/ipc/contracts'
import { DATABASE_SCHEMA_VERSION, PERSISTENCE_LIMITS, WORKSPACE_READ_LIMITS } from '../shared/constants'
import { backupSchema } from '../shared/ipc/backupSchemas'
import { aiSendSchema, saveAssistantSchema } from '../shared/ipc/schemas'
import type {
  ProviderConfigurationInput,
  ProviderConfigurationSummary,
} from '../shared/ai/providerConfiguration'
import type { ModelDescriptor } from '../shared/ai/model'
import { canonicalTestPath, expectUserOnlyMode, removeTestDirectory } from './helpers/platform'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

const electron = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>()
  const rendererListeners = new Map<string, Set<(event: unknown, payload: unknown) => void>>()
  const dialogs = {
    open: [] as Array<{ canceled: boolean; filePaths: string[] }>,
    save: [] as Array<{ canceled: boolean; filePath?: string }>,
    message: [] as Array<{ response: number }>,
  }
  let exposed: NocturneApi | null = null
  let clipboardText = ''
  let beforeShellOpenPath: (() => void) | null = null
  const shellOpenPath = vi.fn(async (filePath: string) => {
    void filePath
    beforeShellOpenPath?.()
    return ''
  })
  const mainFrame = { routingId: 1, url: 'file:///nocturne/index.html' }
  const mainWebContents: { send(channel: string, payload: unknown): void; mainFrame: typeof mainFrame; getURL(): string } = {
    send: (channel, payload) => rendererListeners.get(channel)?.forEach((listener) => listener({}, payload)),
    mainFrame,
    getURL: () => mainFrame.url,
  }
  return {
    handlers,
    rendererListeners,
    dialogs,
    get exposed() { return exposed },
    setExposed(api: NocturneApi) { exposed = api },
    get clipboardText() { return clipboardText },
    set clipboardText(value: string) { clipboardText = value },
    shellOpenPath,
    setBeforeShellOpenPath(callback: (() => void) | null) { beforeShellOpenPath = callback },
    mainFrame,
    mainWebContents,
  }
})

vi.mock('electron', () => ({
  BrowserWindow: class { webContents = electron.mainWebContents },
  contextBridge: { exposeInMainWorld: (_name: string, api: NocturneApi) => electron.setExposed(api) },
  clipboard: { readText: vi.fn(() => electron.clipboardText), writeText: vi.fn((value: string) => { electron.clipboardText = value }) },
  dialog: {
    showOpenDialog: vi.fn(async () => electron.dialogs.open.shift() ?? { canceled: true, filePaths: [] }),
    showSaveDialog: vi.fn(async () => electron.dialogs.save.shift() ?? { canceled: true }),
    showMessageBox: vi.fn(async () => electron.dialogs.message.shift() ?? { response: 1 }),
  },
  ipcMain: {
    handle: (channel: string, handler: IpcHandler) => {
      if (electron.handlers.has(channel)) throw new Error(`Handler already registered for '${channel}'`)
      electron.handlers.set(channel, handler)
    },
    removeHandler: (channel: string) => electron.handlers.delete(channel),
  },
  ipcRenderer: {
    invoke: async (channel: string, ...args: unknown[]) => {
      const handler = electron.handlers.get(channel)
      if (!handler) throw new Error(`Handler IPC ausente: ${channel}`)
      return handler({ sender: electron.mainWebContents, senderFrame: electron.mainFrame }, ...args)
    },
    on: (channel: string, listener: (event: unknown, payload: unknown) => void) => {
      const listeners = electron.rendererListeners.get(channel) ?? new Set()
      listeners.add(listener)
      electron.rendererListeners.set(channel, listeners)
    },
    removeListener: (channel: string, listener: (event: unknown, payload: unknown) => void) => electron.rendererListeners.get(channel)?.delete(listener),
  },
  shell: { openPath: (filePath: string) => electron.shellOpenPath(filePath), showItemInFolder: vi.fn(), openExternal: vi.fn(async () => undefined) },
}))

class SimulatedProviderConfigurations {
  private configurations = new Map<string, ProviderConfigurationSummary>()
  readonly submittedCredentials: string[] = []
  private nextId = 0

  list() {
    return [...this.configurations.values()]
  }

  async create(input: ProviderConfigurationInput, change?: { credential?: string }) {
    this.nextId += 1
    const id = `00000000-0000-4000-8000-${String(this.nextId).padStart(12, '0')}`
    const credential = change?.credential
    const created: ProviderConfigurationSummary = {
      id, enabled: input.enabled ?? true, displayName: input.displayName, source: input.source,
      providerType: 'openai-compatible', baseUrl: input.baseUrl,
      requiresAuthentication: credential ? true : input.requiresAuthentication ?? false,
      credentialConfigured: Boolean(credential), timeoutMs: input.timeoutMs ?? 60000,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    this.configurations.set(id, created)
    if (credential) this.submittedCredentials.push(credential)
    return created
  }

  async update(id: string, input: ProviderConfigurationInput, change?: { credential?: string; clearCredential?: boolean }) {
    const current = this.configurations.get(id)
    if (!current) throw new Error('Provider não encontrado.')
    const updated = { ...current, displayName: input.displayName, baseUrl: input.baseUrl, source: input.source, requiresAuthentication: input.requiresAuthentication ?? false, updatedAt: new Date().toISOString() }
    this.configurations.set(id, updated)
    if (change?.credential) this.submittedCredentials.push(change.credential)
    return updated
  }

  async remove(id: string) {
    if (!this.configurations.has(id)) return false
    this.configurations.delete(id)
    return true
  }

  async testConnection(_id: string) {
    void _id
    return { status: 'available' as const }
  }

  async diagnose(id: string) {
    const provider = this.configurations.get(id)
    if (!provider) throw new Error('Provider não encontrado.')
    const checkedAt = new Date().toISOString()
    return {
      providerId: id,
      definition: {
        id,
        displayName: provider.displayName,
        source: provider.source,
        protocol: 'OpenAI-compatible',
        version: 'v1',
        capabilities: { modelDiscovery: true, streaming: true, toolCalling: false, cancellation: true, authentication: 'required' as const },
        limitations: { requestTimeoutMs: { minimum: 1_000, maximum: 120_000 }, notes: [] },
      },
      availability: { status: 'available' as const, checkedAt },
      connectivity: 'connected' as const,
      authentication: 'configured' as const,
      compatibility: 'compatible' as const,
      latencyMs: 5,
      checkedAt,
      recentErrors: [],
    }
  }
}

class SimulatedModelCatalog {
  models: ModelDescriptor[] = []
  list() { return this.models }
  async refresh(_id: string) {
    void _id
    return { status: 'applied' as const, models: [] }
  }
}

const simulatedModel: ModelDescriptor = {
  providerId: 'unique-test', modelId: 'example', displayName: 'Example Model', source: 'remote',
  capabilities: ['chat', 'streaming'] as const, availability: 'available',
}

describe('limites entre processos Electron (IPC, preload, SQLite)', () => {
  let api: NocturneApi
  let database: Awaited<ReturnType<typeof createDatabase>> | null = null
  let disposeIpc: (() => void) | null = null
  let reinstallIpc: (() => () => void) | null = null
  let root: string
  const electronMock = electron

  async function createDatabase(userDataPath: string) {
    const { LocalDatabase } = await import('../electron/database/Database')
    const db = new LocalDatabase(userDataPath)
    return db
  }

  beforeAll(async () => {
    root = canonicalTestPath(fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-boundary-')))
    database = await createDatabase(root)
    fs.mkdirSync(workspace, { recursive: true })
    const { registerIpc } = await import('../electron/ipc/registerIpc')
    const { Logger } = await import('../electron/logging/Logger')
    const { ModelRegistry } = await import('../electron/ai/ModelRegistry')
    const { ProviderRegistry } = await import('../electron/ai/ProviderRegistry')
    const logger = new Logger(root)
    const providers = new SimulatedProviderConfigurations()
    const simulatedModelCatalog = new SimulatedModelCatalog()
    simulatedModelCatalog.models.push(simulatedModel)
    const testModelRegistry = new ModelRegistry()
    testModelRegistry.register(simulatedModel)
    const testProviderRegistry = new ProviderRegistry()

    const mockBrowserWindow = { webContents: electronMock.mainWebContents }
    reinstallIpc = () => registerIpc(
      mockBrowserWindow as never,
      database!,
      logger,
      providers as never,
      simulatedModelCatalog as never,
      testModelRegistry,
      testProviderRegistry,
    )
    disposeIpc = reinstallIpc()
    await import('../electron/preload')
    if (!electron.exposed) throw new Error('O preload não expôs window.nocturne.')
    api = electron.exposed
  })

  afterAll(() => {
    disposeIpc?.()
    database?.close()
    removeTestDirectory(root)
  })

  function seedUnauthorizedKnowledgeState() {
    const restoredWorkspace = path.join(root, 'restored-knowledge-workspace')
    fs.mkdirSync(restoredWorkspace, { recursive: true })
    const now = new Date().toISOString()
    const conversationId = randomUUID()
    const messageId = randomUUID()
    database!.importData({
      workspaces: [{ path: restoredWorkspace, name: 'Restored knowledge workspace', favorite: 0, authorized: 1, created_at: now, last_opened_at: now }],
      conversations: [{ id: conversationId, title: 'Conversa restaurada', workspace: restoredWorkspace, codex_thread_id: null, created_at: now, updated_at: now }],
      messages: [{ id: messageId, conversation_id: conversationId, role: 'assistant', content: 'Histórico somente leitura preservado.', metadata: null, created_at: now }],
      artifacts: [], memories: [], suggestions: [], suggestionDecisions: [], providerConfigs: [], modelCatalog: [], workspaceModelBindings: [],
    })
    const artifact = database!.addArtifact(conversationId, restoredWorkspace, 'markdown', 'Artefato restaurado', null, 'Conteúdo restaurado')
    const suggestion = database!.addSuggestion(conversationId, restoredWorkspace, {
      title: 'Sugestão restaurada', description: 'Descrição preservada', reasoning: 'Evidência preservada', category: 'testing', severity: 'low',
      affectedFiles: ['tests/fixture.ts'], proposedChanges: 'Manter o teste', expectedBenefits: ['Regressão coberta'], complexity: 'low', risk: 'low',
    })
    return { restoredWorkspace, conversationId, artifactId: artifact.id, suggestionId: suggestion.id }
  }

  function structuredSuggestion(title: string) {
    return `Texto da revisão.\n\n\`\`\`nocturne-suggestions\n${JSON.stringify([{
      title, description: 'Uma sugestão criada após autorização explícita.', reasoning: 'O workspace foi autorizado no processo principal.', category: 'testing', severity: 'medium',
      affectedFiles: ['tests/authorization.ts'], proposedChanges: 'Adicionar cobertura de autorização.', expectedBenefits: ['Mutações protegidas'], complexity: 'low', risk: 'low',
    }])}\n\`\`\``
  }

  it('expõe somente a API nomeada e cruza preload, IPC e SQLite', async () => {
    expect(Object.keys(api).sort()).toEqual(['ai', 'artifacts', 'brain', 'clipboard', 'codex', 'conversations', 'data', 'diagnostics', 'documents', 'files', 'git', 'memory', 'models', 'providers', 'settings', 'suggestions', 'workspace'])
    await api.clipboard.writeText('commit sugerido')
    await expect(api.clipboard.readText()).resolves.toBe('commit sugerido')
    electron.dialogs.open.push({ canceled: false, filePaths: [workspace] })
    await expect(api.workspace.select()).resolves.toBe(workspace)
    expect(fs.existsSync(path.join(workspace, '.nocturne', 'project.json'))).toBe(true)
    const copiedDiagnostic = JSON.parse(await api.diagnostics.copy()) as { session: { sessionId: string }; providers: { configured: number } }
    expect(copiedDiagnostic.session.sessionId).toMatch(/^[a-f0-9-]{36}$/)
    expect(copiedDiagnostic.providers.configured).toBe(0)
    const diagnosticPath = path.join(root, 'diagnostic.json')
    electron.dialogs.save.push({ canceled: false, filePath: diagnosticPath })
    await expect(api.diagnostics.export()).resolves.toBe(diagnosticPath)
    expectUserOnlyMode(fs.statSync(diagnosticPath).mode)
    expect(fs.readFileSync(diagnosticPath, 'utf8')).not.toMatch(/prompt|content|credential/i)
    await expect(api.models.list()).resolves.toEqual([simulatedModel])
    await expect(api.models.refresh(simulatedModel.providerId)).resolves.toMatchObject({
      status: 'applied',
      models: [],
    })
    const bindings = {
      workspaceId: workspace,
      defaultBinding: {
        providerId: simulatedModel.providerId,
        modelId: simulatedModel.modelId,
      },
    }
    await expect(api.models.setBindings(bindings)).resolves.toEqual(bindings)
    await expect(api.models.bindings(workspace)).resolves.toEqual(bindings)

    const conversation = await api.conversations.create(workspace)
    expect((await api.conversations.messages(conversation.id)).map((message) => message.content)).toEqual([])
    expect(conversation).toMatchObject({ id: expect.any(String), title: 'Nova conversa', workspace })
    await api.conversations.delete(conversation.id)
  })

  it('rejeita payloads de anexos inválidos antes de acessar o workspace', async () => {
    const handler = electronMock.handlers.get('ai:send')
    if (!handler) throw new Error('Handler ai:send ausente.')
    const event = { sender: electronMock.mainWebContents, senderFrame: electronMock.mainFrame }
    await expect(handler(event, {
      conversationId: randomUUID(), prompt: 'teste', attachments: Array.from({ length: 11 }, () => 'arquivo.txt'), mode: 'review',
    })).rejects.toThrow()
    expect(() => aiSendSchema.parse({
      conversationId: randomUUID(), prompt: 'teste', attachments: [42], mode: 'review',
    })).toThrow()
    expect(() => aiSendSchema.parse({
      conversationId: randomUUID(), prompt: 'teste', attachments: ['arquivo.txt'], mode: 'review', extra: true,
    })).toThrow()

    const conversation = await api.conversations.create(workspace)
    try {
      await expect(api.ai.send(conversation.id, 'teste', ['../fora.txt'], 'review')).rejects.toThrow(/dentro do workspace/)
      await expect(api.ai.send(conversation.id, 'teste', [path.join(os.tmpdir(), 'fora.txt')], 'review')).rejects.toThrow(/dentro do workspace/)
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-ipc-outside-'))
      const link = path.join(workspace, 'ipc-link.txt')
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'externo')
      fs.symlinkSync(path.join(outside, 'secret.txt'), link)
      try {
        await expect(api.ai.send(conversation.id, 'teste', ['ipc-link.txt'], 'review')).rejects.toThrow(/dentro do workspace/)
      } finally {
        fs.rmSync(link, { force: true })
        removeTestDirectory(outside)
      }
    } finally {
      await api.conversations.delete(conversation.id)
    }
  })

  it('limita metadata de ai:save-assistant antes da transação e mantém o backup válido', async () => {
    electron.dialogs.open.push({ canceled: false, filePaths: [workspace] })
    await api.workspace.select()
    const conversation = await api.conversations.create(workspace)
    const event = { sender: electronMock.mainWebContents, senderFrame: electronMock.mainFrame }
    try {
      const withoutMetadata = await api.ai.saveAssistant(conversation.id, 'Resposta sem metadata')
      expect(withoutMetadata.metadata).toBeNull()
      const validMetadata = { diff: 'diff pequeno', files: [{ path: 'src/App.tsx', kind: 'modified' }], plan: [{ step: 'validar' }], optional: null }
      const saved = await api.ai.saveAssistant(conversation.id, 'Resposta persistida', validMetadata)
      expect(JSON.parse(saved.metadata ?? 'null')).toEqual(validMetadata)
      const genericMetadata = { nested: [null, true], files: [null, 'ignorar'], diff: false }
      const generic = await api.ai.saveAssistant(conversation.id, 'Metadata genérico', genericMetadata)
      expect(JSON.parse(generic.metadata ?? 'null')).toEqual(genericMetadata)

      const metadataAtLimit = 'x'.repeat(PERSISTENCE_LIMITS.metadataCharacters - 2)
      const atLimit = await api.ai.saveAssistant(conversation.id, 'Resposta no limite', metadataAtLimit)
      expect(atLimit.metadata).toHaveLength(PERSISTENCE_LIMITS.metadataCharacters)
      expect(() => backupSchema.parse(database!.exportData())).not.toThrow()

      const messagesBeforeRejection = database!.listMessages(conversation.id)
      const artifactsBeforeRejection = database!.listArtifacts(conversation.id)
      await expect(api.ai.saveAssistant(conversation.id, 'Não persistir', `${metadataAtLimit}x`)).rejects.toThrow(/metadata/i)
      const cyclic: Record<string, unknown> = {}
      cyclic.self = cyclic
      const saveAssistantHandler = electronMock.handlers.get('ai:save-assistant')
      if (!saveAssistantHandler) throw new Error('Handler ai:save-assistant ausente.')
      expect(() => saveAssistantHandler(event, { conversationId: conversation.id, content: 'Também não persistir', metadata: cyclic })).toThrow()
      expect(database!.listMessages(conversation.id)).toEqual(messagesBeforeRejection)
      expect(database!.listArtifacts(conversation.id)).toEqual(artifactsBeforeRejection)
      expect(saveAssistantSchema.safeParse({ conversationId: conversation.id, content: 'Resposta', metadata: { unsupported: 1n } }).success).toBe(false)
    } finally {
      await api.conversations.delete(conversation.id)
    }
  })

  it('atualiza metadata stale do workspace sem apagar contexto local', async () => {
    const metadataWorkspace = path.join(root, 'metadata-workspace')
    fs.mkdirSync(metadataWorkspace)
    fs.writeFileSync(path.join(metadataWorkspace, 'package.json'), JSON.stringify({
      name: 'metadata-fixture',
      scripts: { test: 'vitest run' },
    }))
    fs.writeFileSync(path.join(metadataWorkspace, 'tsconfig.json'), '{}\n')
    electron.dialogs.open.push({ canceled: false, filePaths: [metadataWorkspace] })
    await expect(api.workspace.select()).resolves.toBe(metadataWorkspace)

    const projectPath = path.join(metadataWorkspace, '.nocturne', 'project.json')
    fs.writeFileSync(projectPath, JSON.stringify({
      name: 'nocturne-codex',
      stack: ['Node.js'],
      primaryLanguage: 'JavaScript',
      commands: { build: 'vite build' },
    }))
    const memoryPath = path.join(metadataWorkspace, '.nocturne', 'memory.md')
    fs.writeFileSync(memoryPath, '# Memória preservada\n')

    const conversation = await api.conversations.create(metadataWorkspace)
    try {
      const refreshed = JSON.parse(fs.readFileSync(projectPath, 'utf8')) as {
        name: string
        stack: string[]
        primaryLanguage: string
        commands: Record<string, string>
      }

      expect(refreshed.name).toBe(path.basename(metadataWorkspace))
      expect(refreshed.stack).toEqual(expect.arrayContaining(['Node.js']))
      expect(refreshed.primaryLanguage).toBe('TypeScript')
      expect(refreshed.commands).toHaveProperty('test', 'vitest run')
      expect(fs.readFileSync(memoryPath, 'utf8')).toBe('# Memória preservada\n')
    } finally {
      await api.conversations.delete(conversation.id)
    }
  })

  it('falha de forma controlada para contexto e metadata acima dos limites', async () => {
    const contextWorkspace = path.join(root, 'oversized-context-workspace')
    fs.mkdirSync(contextWorkspace)
    electron.dialogs.open.push({ canceled: false, filePaths: [contextWorkspace] })
    await api.workspace.select()
    const memoryPath = path.join(contextWorkspace, '.nocturne', 'memory.md')
    fs.writeFileSync(memoryPath, Buffer.alloc(WORKSPACE_READ_LIMITS.workspaceContextBytes + 1, 0x6d))
    const contextConversation = await api.conversations.create(contextWorkspace)
    try {
      await expect(api.memory.get(contextConversation.id)).rejects.toThrow(/limite permitido/)
    } finally {
      await api.conversations.delete(contextConversation.id)
    }

    const packageWorkspace = path.join(root, 'oversized-package-workspace')
    fs.mkdirSync(packageWorkspace)
    fs.writeFileSync(path.join(packageWorkspace, 'package.json'), JSON.stringify({ name: 'package-fixture' }))
    electron.dialogs.open.push({ canceled: false, filePaths: [packageWorkspace] })
    await api.workspace.select()
    fs.writeFileSync(path.join(packageWorkspace, 'package.json'), Buffer.alloc(WORKSPACE_READ_LIMITS.packageMetadataBytes + 1, 0x70))
    await expect(api.conversations.create(packageWorkspace)).rejects.toThrow(/package\.json excede o limite permitido/)

    const projectWorkspace = path.join(root, 'oversized-project-workspace')
    fs.mkdirSync(projectWorkspace)
    electron.dialogs.open.push({ canceled: false, filePaths: [projectWorkspace] })
    await api.workspace.select()
    fs.writeFileSync(path.join(projectWorkspace, '.nocturne', 'project.json'), Buffer.alloc(WORKSPACE_READ_LIMITS.projectMetadataBytes + 1, 0x70))
    await expect(api.conversations.create(projectWorkspace)).rejects.toThrow(/metadata do projeto excede o limite permitido/)
  })

  it('persiste e recupera conversas com paginação', async () => {
    const c1 = await api.conversations.create(workspace)
    const page = await api.conversations.page()
    expect(page.items).toHaveLength(1)
    expect(page.items[0].id).toBe(c1.id)
    expect(page.hasMore).toBe(false)
    for (let i = 0; i < 5; i++) await api.conversations.create(workspace)
    const paginated = await api.conversations.page(0, 3)
    expect(paginated.items).toHaveLength(3)
    expect(paginated.hasMore).toBe(true)
  })

  it('propaga mudanças externas pelo canal nomeado do preload', async () => {
    const changed = new Promise<Parameters<Parameters<typeof api.workspace.onChanged>[0]>[0]>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Mudança externa não detectada.')), 3_000)
      const off = api.workspace.onChanged((event) => {
        if (!event.paths.includes('external-change.txt')) return
        clearTimeout(timeout)
        off()
        resolve(event)
      })
    })
    await api.workspace.watch(workspace)
    fs.writeFileSync(path.join(workspace, 'external-change.txt'), 'mudança externa')

    await expect(changed).resolves.toMatchObject({
      workspace,
      paths: expect.arrayContaining(['external-change.txt']),
      overflow: false,
    })
    await api.workspace.watch(null)
  })

  it('revoga a autorização efetiva quando a pasta salva deixa de existir', async () => {
    const movedWorkspace = path.join(root, 'moved-workspace')
    fs.mkdirSync(movedWorkspace)
    electron.dialogs.open.push({ canceled: false, filePaths: [movedWorkspace] })
    await expect(api.workspace.select()).resolves.toBe(movedWorkspace)
    expect(await api.workspace.list()).toContainEqual(expect.objectContaining({
      path: movedWorkspace,
      authorized: true,
      availability: 'available',
    }))

    fs.rmSync(movedWorkspace, { recursive: true })

    expect(await api.workspace.list()).toContainEqual(expect.objectContaining({
      path: movedWorkspace,
      authorized: false,
      availability: 'missing',
      availabilityMessage: 'Pasta do projeto não encontrada.',
    }))
  })

  it('reassocia o histórico após confirmar a nova localização de um projeto movido', async () => {
    const source = path.join(root, 'relocation-source')
    const destination = path.join(root, 'relocation-destination')
    fs.mkdirSync(source)
    fs.mkdirSync(destination)
    electron.dialogs.open.push({ canceled: false, filePaths: [source] })
    await api.workspace.select()
    const conversation = await api.conversations.create(source)
    fs.rmSync(source, { recursive: true })

    electron.dialogs.open.push({ canceled: false, filePaths: [destination] })
    await expect(api.workspace.select(source)).resolves.toBe(destination)

    expect(await api.workspace.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: destination, authorized: true, availability: 'available' }),
    ]))
    expect((await api.conversations.list()).find((item) => item.id === conversation.id)?.workspace).toBe(destination)
    expect(fs.existsSync(path.join(destination, '.nocturne', 'project.json'))).toBe(true)
  })

  it('rejeita caminhos de workspace fora do escopo durante a importação de backup', async () => {
    const blockedWorkspace = path.parse(process.cwd()).root
    const backup = {
      schemaVersion: DATABASE_SCHEMA_VERSION, exportedAt: new Date().toISOString(),
      workspaces: [{ path: blockedWorkspace, name: 'system-root', favorite: 0 as const, created_at: new Date().toISOString(), last_opened_at: new Date().toISOString() }],
      conversations: [], messages: [], artifacts: [], memories: [], suggestions: [], suggestionDecisions: [], providerConfigs: [], modelCatalog: [], workspaceModelBindings: [],
    }
    const { backupSchema } = await import('../shared/ipc/backupSchemas')
    expect(() => backupSchema.parse(backup)).not.toThrow()
    const { assertSafeWorkspaceScope } = await import('../electron/security/WorkspaceTrust')
    expect(() => assertSafeWorkspaceScope(blockedWorkspace, false)).toThrow(/Selecione uma pasta de projeto específica/)
  })

  it('gerencia o ciclo de vida completo de providers via IPC', async () => {
    const created = await api.providers.create({
      providerType: 'openai-compatible', displayName: 'Test OpenAI',
      baseUrl: 'https://api.openai.com/v1', source: 'remote', requiresAuthentication: true,
      enabled: true, timeoutMs: 60000,
    }, 'sk-test-123')
    expect(created.id).toBeTruthy()
    expect(created.displayName).toBe('Test OpenAI')
    expect(created.baseUrl).toBe('https://api.openai.com/v1')
    expect(created.enabled).toBe(true)

    const list = await api.providers.list()
    expect(list).toHaveLength(1)
    expect(list[0].displayName).toBe('Test OpenAI')

    const availability = await api.providers.testConnection(created.id)
    expect(availability.status).toBe('available')
    await expect(api.providers.diagnose(created.id)).resolves.toMatchObject({
      definition: { protocol: 'OpenAI-compatible', version: 'v1' },
      connectivity: 'connected',
      authentication: 'configured',
      compatibility: 'compatible',
      latencyMs: 5,
    })

    const updated = await api.providers.update(created.id, {
      providerType: 'openai-compatible', displayName: 'Updated OpenAI',
      baseUrl: 'https://updated.openai.com/v1', source: 'remote', requiresAuthentication: true,
      enabled: true, timeoutMs: 60000,
    })
    expect(updated.displayName).toBe('Updated OpenAI')

    await api.providers.remove(created.id)
    expect(await api.providers.list()).toHaveLength(0)
  })

  it('salva settings parciais sem apagar diagnosticMode', async () => {
    await api.settings.set({ diagnosticMode: true })
    const english = await api.settings.set({ language: 'en' })
    expect(english.language).toBe('en')
    const saved = await api.settings.set({ model: 'gpt-5' })
    expect(saved.model).toBe('gpt-5')
    expect(saved.diagnosticMode).toBe(true)
    expect(saved.language).toBe('en')
    const current = await api.settings.get()
    expect(current.model).toBe('gpt-5')
    expect(current.diagnosticMode).toBe(true)
    expect(current.language).toBe('en')
  })

  it('exporta backup atômico com formato e checksum verificáveis', async () => {
    const destination = path.join(root, 'verified-backup.json')
    electron.dialogs.message.push({ response: 0 })
    electron.dialogs.save.push({ canceled: false, filePath: destination })

    await expect(api.data.export()).resolves.toBe(destination)

    const exported = JSON.parse(fs.readFileSync(destination, 'utf8')) as {
      format: string
      formatVersion: number
      integrity: { algorithm: string; checksum: string }
    }
    expect(exported).toMatchObject({
      format: 'nocturne-studio-backup',
      formatVersion: 1,
      integrity: { algorithm: 'sha256', checksum: expect.stringMatching(/^[a-f0-9]{64}$/) },
    })
    expectUserOnlyMode(fs.statSync(destination).mode)
    expect(fs.readdirSync(root).some((name) => name.startsWith('verified-backup.json.tmp-'))).toBe(false)
  })

  it('rejeita credenciais em backup e remove codexPath das settings importadas', async () => {
    const { backupSchema } = await import('../shared/ipc/backupSchemas')
    const backup = {
      schemaVersion: DATABASE_SCHEMA_VERSION, exportedAt: new Date().toISOString(),
      workspaces: [{ path: root, name: 'test', favorite: 0 as const, created_at: new Date().toISOString(), last_opened_at: new Date().toISOString() }],
      conversations: [], messages: [], artifacts: [], memories: [], providerConfigs: [], modelCatalog: [], workspaceModelBindings: [],
      settings: { model: 'gpt-4' },
    }
    expect(() => backupSchema.parse(backup)).not.toThrow()
    const validated = backupSchema.parse(backup)
    expect(validated.settings).not.toHaveProperty('codexPath')
  })

  it('permite restaurar dados de projeto preservando configurações locais', async () => {
    const importPath = path.join(root, 'partial-backup.json')
    const now = new Date().toISOString()
    fs.writeFileSync(importPath, JSON.stringify({
      schemaVersion: DATABASE_SCHEMA_VERSION,
      exportedAt: now,
      workspaces: [{ path: root, name: 'restored', favorite: 0, created_at: now, last_opened_at: now }],
      conversations: [],
      messages: [],
      artifacts: [],
      memories: [],
      brainMemories: [],
      suggestions: [],
      suggestionDecisions: [],
      providerConfigs: [],
      modelCatalog: [],
      workspaceModelBindings: [],
      settings: { model: 'modelo-do-backup' },
    }))
    electron.dialogs.open.push({ canceled: false, filePaths: [importPath] })
    electron.dialogs.message.push({ response: 2 })

    await expect(api.data.import()).resolves.toBe(true)

    expect((await api.settings.get()).model).toBe('gpt-5')
    expect((await api.workspace.list())[0]).toMatchObject({ path: root, authorized: false })
    expect(fs.readdirSync(path.join(root, 'backups')).some((name) => name.startsWith('nocturne-before-restore-'))).toBe(true)
  })

  it('descarta e registra novamente todos os handlers ao recriar a janela', async () => {
    const registeredHandlers = electronMock.handlers.size
    expect(registeredHandlers).toBeGreaterThan(0)

    disposeIpc?.()
    disposeIpc = null
    expect(electronMock.handlers.size).toBe(0)

    disposeIpc = reinstallIpc?.() ?? null
    expect(electronMock.handlers.size).toBe(registeredHandlers)
    await expect(api.clipboard.writeText('handler reaberto')).resolves.toBeUndefined()
  })

  it('mantém o destino canônico quando o symlink muda antes da abertura', async () => {
    const project = path.join(root, 'open-race-project')
    const safe = path.join(project, 'safe')
    const outside = path.join(root, 'open-race-outside')
    const link = path.join(project, 'current')
    fs.mkdirSync(safe, { recursive: true })
    fs.mkdirSync(outside, { recursive: true })
    fs.writeFileSync(path.join(safe, 'notes.txt'), 'interno')
    fs.writeFileSync(path.join(outside, 'notes.txt'), 'externo')
    fs.symlinkSync(safe, link, 'dir')
    electron.dialogs.open.push({ canceled: false, filePaths: [project] })
    await api.workspace.select()
    const conversation = await api.conversations.create(project)
    electronMock.setBeforeShellOpenPath(() => {
      electronMock.setBeforeShellOpenPath(null)
      fs.unlinkSync(link)
      fs.symlinkSync(outside, link, 'dir')
    })

    await expect(
      api.files.open(conversation.id, 'current/notes.txt', 'file'),
    ).resolves.toBeUndefined()

    expect(electronMock.shellOpenPath).toHaveBeenCalledOnce()
    expect(electronMock.shellOpenPath).toHaveBeenCalledWith(
      path.join(safe, 'notes.txt'),
    )
    expect(electronMock.shellOpenPath).not.toHaveBeenCalledWith(
      path.join(outside, 'notes.txt'),
    )
  })

  it('rejeita exportação quando o symlink do destino troca antes do rename', async () => {
    if (process.platform === 'win32') return
    const project = path.join(root, 'export-race-project')
    const safe = path.join(project, 'safe')
    const outside = path.join(root, 'export-race-outside')
    const link = path.join(project, 'current')
    const bin = path.join(root, 'export-race-bin')
    const pandoc = path.join(bin, 'pandoc')
    fs.mkdirSync(safe, { recursive: true })
    fs.mkdirSync(outside, { recursive: true })
    fs.mkdirSync(bin, { recursive: true })
    fs.symlinkSync(safe, link, 'dir')
    const fakePandoc = [
      '#!/bin/sh',
      'output=""',
      'while [ "$#" -gt 0 ]; do',
      '  if [ "$1" = "-o" ]; then output="$2"; shift 2; else shift; fi',
      'done',
      'cat > "$output"',
      `rm -f ${JSON.stringify(link)}`,
      `ln -s ${JSON.stringify(outside)} ${JSON.stringify(link)}`,
      '',
    ].join('\n')
    fs.writeFileSync(pandoc, fakePandoc)
    fs.chmodSync(pandoc, 0o700)
    const previousPath = process.env.PATH
    process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ''}`
    try {
      electron.dialogs.open.push({ canceled: false, filePaths: [project] })
      await api.workspace.select()
      const conversation = await api.conversations.create(project)
      electron.dialogs.save.push({ canceled: false, filePath: path.join(project, 'current', 'result.html') })

      await expect(api.documents.export(conversation.id, '# conteúdo', 'html')).rejects.toThrow(/destino da exportação|fora do workspace/)
      expect(fs.existsSync(path.join(outside, 'result.html'))).toBe(false)
    } finally {
      process.env.PATH = previousPath
    }
  })

  it('preserva histórico read-only e rejeita mutações de knowledge em workspace não autorizado', async () => {
    const state = seedUnauthorizedKnowledgeState()

    await expect(api.conversations.messages(state.conversationId)).resolves.toEqual([
      expect.objectContaining({ content: 'Histórico somente leitura preservado.' }),
    ])
    await expect(api.artifacts.delete(state.conversationId, state.artifactId)).rejects.toThrow(/Workspace não autorizado/)
    expect((await api.artifacts.page(state.conversationId)).items).toEqual([
      expect.objectContaining({ id: state.artifactId, title: 'Artefato restaurado' }),
    ])

    const beforeSuggestions = await api.suggestions.page(state.conversationId)
    expect(beforeSuggestions.items).toEqual([expect.objectContaining({ id: state.suggestionId, title: 'Sugestão restaurada' })])
    await expect(api.suggestions.create(state.conversationId, structuredSuggestion('Não deve persistir'))).rejects.toThrow(/Workspace não autorizado/)
    expect(await api.suggestions.page(state.conversationId)).toEqual(beforeSuggestions)

    await expect(api.conversations.delete(state.conversationId)).rejects.toThrow(/Workspace não autorizado/)
    expect((await api.conversations.list()).some((conversation) => conversation.id === state.conversationId)).toBe(true)
    await expect(api.conversations.messages(state.conversationId)).resolves.toEqual([
      expect.objectContaining({ content: 'Histórico somente leitura preservado.' }),
    ])
    expect((await api.artifacts.page(state.conversationId)).items).toEqual([
      expect.objectContaining({ id: state.artifactId, title: 'Artefato restaurado' }),
    ])
    expect((await api.suggestions.page(state.conversationId)).items).toEqual([
      expect.objectContaining({ id: state.suggestionId, title: 'Sugestão restaurada' }),
    ])
  })

  it('permite artifacts:delete e suggestions:create depois da autorização atual', async () => {
    const state = seedUnauthorizedKnowledgeState()
    electron.dialogs.open.push({ canceled: false, filePaths: [state.restoredWorkspace] })
    await expect(api.workspace.select()).resolves.toBe(state.restoredWorkspace)

    await expect(api.artifacts.delete(state.conversationId, state.artifactId)).resolves.toEqual({ deleted: true })
    expect((await api.artifacts.page(state.conversationId)).items).toEqual([])

    await expect(api.suggestions.create(state.conversationId, structuredSuggestion('Persistir após autorização'))).resolves.toMatchObject({
      suggestions: [expect.objectContaining({ title: 'Persistir após autorização' })],
    })
    expect(database!.listSuggestions(state.conversationId)).toEqual([
      expect.objectContaining({ title: 'Persistir após autorização' }),
    ])
    expect(database!.getSuggestion(state.suggestionId)?.status).toBe('resolved')

    await expect(api.conversations.delete(state.conversationId)).resolves.toBeUndefined()
    expect((await api.conversations.list()).some((conversation) => conversation.id === state.conversationId)).toBe(false)
    await expect(api.conversations.messages(state.conversationId)).resolves.toEqual([])
    expect((await api.artifacts.page(state.conversationId)).items).toEqual([])
    expect((await api.suggestions.page(state.conversationId)).items).toEqual([])
  })
})

const workspace = canonicalTestPath('/tmp/test-workspace-nocturne')

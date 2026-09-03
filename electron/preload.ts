import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS as channels } from '../shared/ipc/channels'
import type { AgentEvent, WorkspaceChangeEvent } from '../shared/types'
import type { ProjectIndexStatus, ValidationKind, ValidationRun } from '../shared/codeIntelligence'
import type { ChangeHunkRecord, ChangeRecord, ChangeSetRecord, FileDiff } from '../shared/changeControl'
import type { AgentStatusEvent } from '../shared/agentLifecycle'
import type {
  NocturneApi,
  ModelIpcResult,
  ProviderConfigurationIpcResult,
} from '../shared/ipc/contracts'
import type { ProviderAvailability } from '../shared/ai/provider'
import type { ProviderConfigurationErrorCode } from '../shared/ai/providerConfiguration'
import { COLLECTION_PAGE_LIMITS } from '../shared/constants'
import type { JsonValue } from '../shared/json'

const on = <T>(channel: string, listener: (payload: T) => void) => {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

class ProviderConfigurationClientError extends Error {
  constructor(
    readonly code: ProviderConfigurationErrorCode,
    message: string,
    readonly availability?: ProviderAvailability,
  ) {
    super(message)
    this.name = 'ProviderConfigurationClientError'
  }
}

async function providerResult<T>(
  result: Promise<ProviderConfigurationIpcResult<T>>,
): Promise<T> {
  const response = await result
  if (response.ok) return response.value
  throw new ProviderConfigurationClientError(
    response.error.code,
    response.error.message,
    response.error.availability,
  )
}

async function modelResult<T>(result: Promise<ModelIpcResult<T>>): Promise<T> {
  const response = await result
  if (response.ok) return response.value
  const error = new Error(response.error.message)
  error.name = response.error.code
  throw error
}

export const nocturneApi: NocturneApi = {
  workspace: {
    select: (expectedWorkspace?: string) => ipcRenderer.invoke(channels.workspace.select, expectedWorkspace),
    validate: (workspace: string) => ipcRenderer.invoke(channels.workspace.validate, workspace),
    list: () => ipcRenderer.invoke(channels.workspace.list),
    remove: (workspace: string) => ipcRenderer.invoke(channels.workspace.remove, workspace),
    favorite: (workspace: string, favorite: boolean) => ipcRenderer.invoke(channels.workspace.favorite, { workspace, favorite }),
    openTool: (workspace: string, tool: 'editor' | 'terminal') => ipcRenderer.invoke(channels.workspace.openTool, { workspace, tool }),
    watch: (workspace: string | null) => ipcRenderer.invoke(channels.workspace.watch, workspace),
    onChanged: (listener: (event: WorkspaceChangeEvent) => void) => on(channels.workspace.changed, listener),
  },
  projectIndex: {
    status: (workspace: string) => ipcRenderer.invoke(channels.projectIndex.status, { workspace }),
    start: (workspace: string) => ipcRenderer.invoke(channels.projectIndex.start, { workspace }),
    cancel: (workspace: string) => ipcRenderer.invoke(channels.projectIndex.cancel, { workspace }),
    retry: (workspace: string) => ipcRenderer.invoke(channels.projectIndex.retry, { workspace }),
    summary: (workspace: string) => ipcRenderer.invoke(channels.projectIndex.summary, { workspace }),
    files: (workspace: string, limit = 50_000) => ipcRenderer.invoke(channels.projectIndex.files, { workspace, limit }),
    symbols: (workspace: string, query = '', limit = 100) => ipcRenderer.invoke(channels.projectIndex.symbols, { workspace, query, limit }),
    imports: (workspace: string, relativePath?: string) => ipcRenderer.invoke(channels.projectIndex.imports, { workspace, relativePath }),
    exports: (workspace: string, relativePath?: string) => ipcRenderer.invoke(channels.projectIndex.exports, { workspace, relativePath }),
    stack: (workspace: string) => ipcRenderer.invoke(channels.projectIndex.stack, { workspace }),
    exclusions: (workspace: string) => ipcRenderer.invoke(channels.projectIndex.exclusions, { workspace }),
    onStatus: (listener: (status: ProjectIndexStatus) => void) => on(channels.projectIndex.changed, listener),
  },
  validation: {
    run: (workspace: string, kind: ValidationKind) => ipcRenderer.invoke(channels.validation.run, { workspace, kind }),
    cancel: (workspace: string) => ipcRenderer.invoke(channels.validation.cancel, { workspace }),
    list: (workspace: string, limit = 20) => ipcRenderer.invoke(channels.validation.list, { workspace, limit }),
    latest: (workspace: string) => ipcRenderer.invoke(channels.validation.latest, { workspace }),
    onStatus: (listener: (run: ValidationRun) => void) => on(channels.validation.changed, listener),
  },
  changeControl: {
    get: (conversationId: string, executionId: string) => ipcRenderer.invoke(channels.changeControl.get, { conversationId, executionId }) as Promise<ChangeSetRecord | null>,
    changes: (conversationId: string, changeSetId: string) => ipcRenderer.invoke(channels.changeControl.changes, { conversationId, changeSetId }) as Promise<ChangeRecord[]>,
    diff: (conversationId: string, changeId: string) => ipcRenderer.invoke(channels.changeControl.diff, { conversationId, changeId }) as Promise<FileDiff | null>,
    hunks: (conversationId: string, changeId: string) => ipcRenderer.invoke(channels.changeControl.hunks, { conversationId, changeId }) as Promise<ChangeHunkRecord[]>,
    editHunk: (conversationId: string, hunkId: string, finalPatch: string) => ipcRenderer.invoke(channels.changeControl.editHunk, { conversationId, hunkId, finalPatch }) as Promise<ChangeHunkRecord>,
    decideHunk: (conversationId: string, hunkId: string, status: 'accepted' | 'rejected') => ipcRenderer.invoke(channels.changeControl.decideHunk, { conversationId, hunkId, status }) as Promise<ChangeHunkRecord>,
    decide: (conversationId: string, changeId: string, status: 'accepted' | 'rejected') => ipcRenderer.invoke(channels.changeControl.decide, { conversationId, changeId, status }),
    onChanged: (listener: (value: { executionId: string; changeSetId: string }) => void) => on(channels.changeControl.changed, listener),
  },
  conversations: {
    list: () => ipcRenderer.invoke(channels.conversations.list),
    page: (offset = 0, limit = COLLECTION_PAGE_LIMITS.conversations) => ipcRenderer.invoke(channels.conversations.page, { offset, limit }),
    create: (workspace: string) => ipcRenderer.invoke(channels.conversations.create, workspace),
    messages: (id: string) => ipcRenderer.invoke(channels.conversations.messages, id),
    messagePage: (id: string, offset = 0, limit = 100) => ipcRenderer.invoke(channels.conversations.messagePage, { id, offset, limit }),
    delete: (id: string) => ipcRenderer.invoke(channels.conversations.delete, id),
  },
  ai: {
    send: (conversationId: string, prompt: string, attachments: string[] = [], mode = 'build') => ipcRenderer.invoke(channels.ai.send, { conversationId, prompt, attachments, mode }),
    cancel: (conversationId: string) => ipcRenderer.invoke(channels.ai.cancel, { conversationId }),
    saveAssistant: (conversationId: string, content: string, metadata?: JsonValue) => ipcRenderer.invoke(channels.ai.saveAssistant, { conversationId, content, metadata }),
    approve: (key: string, accepted: boolean, forSession = false) => ipcRenderer.invoke(channels.ai.approve, { key, accepted, forSession }),
    rollbackStatus: (conversationId: string) => ipcRenderer.invoke(channels.ai.rollbackStatus, conversationId),
    rollback: (conversationId: string) => ipcRenderer.invoke(channels.ai.rollback, conversationId),
    onEvent: (listener: (payload: AgentEvent) => void) => on(channels.ai.event, listener),
    onStatus: (listener: (payload: AgentStatusEvent) => void) => on(channels.ai.status, listener),
  },
  codex: {
    status: () => ipcRenderer.invoke(channels.codex.status),
    login: () => ipcRenderer.invoke(channels.codex.login),
    logout: () => ipcRenderer.invoke(channels.codex.logout),
    models: () => ipcRenderer.invoke(channels.codex.models),
  },
  files: {
    attach: (conversationId: string) => ipcRenderer.invoke(channels.files.attach, conversationId),
    open: (conversationId: string, filePath: string, action: 'file' | 'folder' | 'editor') => ipcRenderer.invoke(channels.files.open, { conversationId, filePath, action }),
    preview: (conversationId: string, filePath: string) => ipcRenderer.invoke(channels.files.preview, { conversationId, filePath }),
  },
  memory: { get: (conversationId: string) => ipcRenderer.invoke(channels.memory.get, conversationId), set: (conversationId: string, content: string, rules: string) => ipcRenderer.invoke(channels.memory.set, { conversationId, content, rules }) },
  brain: {
    page: (conversationId, offset = 0, limit = COLLECTION_PAGE_LIMITS.brainMemories, query = '', status) => ipcRenderer.invoke(channels.brain.page, { conversationId, offset, limit, query, status }),
    history: (conversationId, memoryId) => ipcRenderer.invoke(channels.brain.history, { conversationId, memoryId }),
    create: (conversationId, value) => ipcRenderer.invoke(channels.brain.create, { conversationId, ...value }),
    update: (conversationId, memoryId, value) => ipcRenderer.invoke(channels.brain.update, { conversationId, memoryId, ...value }),
    delete: (conversationId, memoryId) => ipcRenderer.invoke(channels.brain.delete, { conversationId, memoryId }),
    extract: (conversationId, content) => ipcRenderer.invoke(channels.brain.extract, { conversationId, content }),
  },
  artifacts: { list: (conversationId: string) => ipcRenderer.invoke(channels.artifacts.list, conversationId), page: (conversationId: string, offset = 0, limit = COLLECTION_PAGE_LIMITS.artifacts) => ipcRenderer.invoke(channels.artifacts.page, { conversationId, offset, limit }), delete: (conversationId: string, artifactId: string) => ipcRenderer.invoke(channels.artifacts.delete, { conversationId, artifactId }) },
  suggestions: { list: (conversationId: string) => ipcRenderer.invoke(channels.suggestions.list, conversationId), page: (conversationId: string, offset = 0, limit = COLLECTION_PAGE_LIMITS.suggestions) => ipcRenderer.invoke(channels.suggestions.page, { conversationId, offset, limit }), create: (conversationId: string, content: string) => ipcRenderer.invoke(channels.suggestions.create, { conversationId, content }), status: (conversationId: string, suggestionId: string, status: string, result?: string) => ipcRenderer.invoke(channels.suggestions.status, { conversationId, suggestionId, status, result }) },
  data: { export: () => ipcRenderer.invoke(channels.data.export), import: () => ipcRenderer.invoke(channels.data.import) },
  diagnostics: { openLogs: () => ipcRenderer.invoke(channels.diagnostics.openLogs), copy: () => ipcRenderer.invoke(channels.diagnostics.copy), export: () => ipcRenderer.invoke(channels.diagnostics.export), rendererError: (value: unknown) => ipcRenderer.invoke(channels.diagnostics.rendererError, value), rendererStats: (value: unknown) => ipcRenderer.invoke(channels.diagnostics.rendererStats, value) },
  settings: { get: () => ipcRenderer.invoke(channels.settings.get), set: (settings: unknown) => ipcRenderer.invoke(channels.settings.set, settings) },
  providers: {
    list: () => providerResult(ipcRenderer.invoke(channels.providers.list)),
    create: (configuration, credential) => providerResult(ipcRenderer.invoke(
      channels.providers.create,
      { configuration, credential },
    )),
    update: (id, configuration, options = {}) => providerResult(ipcRenderer.invoke(
      channels.providers.update,
      { id, configuration, ...options },
    )),
    remove: (id) => providerResult(ipcRenderer.invoke(
      channels.providers.remove,
      { id },
    )),
    testConnection: (id) => providerResult(ipcRenderer.invoke(
      channels.providers.testConnection,
      { id },
    )),
    diagnose: (id) => providerResult(ipcRenderer.invoke(
      channels.providers.diagnose,
      { id },
    )),
  },
  models: {
    list: () => modelResult(ipcRenderer.invoke(channels.models.list)),
    refresh: (providerId) => modelResult(ipcRenderer.invoke(
      channels.models.refresh,
      { providerId },
    )),
    bindings: (workspaceId) => modelResult(ipcRenderer.invoke(
      channels.models.bindings,
      { workspaceId },
    )),
    setBindings: (bindings) => modelResult(ipcRenderer.invoke(
      channels.models.setBindings,
      bindings,
    )),
  },
  git: { status: (conversationId: string) => ipcRenderer.invoke(channels.git.status, conversationId), commit: (conversationId: string, message: string, files: string[]) => ipcRenderer.invoke(channels.git.commit, { conversationId, message, files }) },
  documents: {
    prepareMarkdown: (conversationId: string, content: string, name?: string) => ipcRenderer.invoke(channels.documents.prepareMarkdown, { conversationId, content, name }),
    applyMarkdown: (conversationId, preview, strategy) => ipcRenderer.invoke(channels.documents.applyMarkdown, { conversationId, target: preview.target, generated: preview.generated, expectedHash: preview.expectedHash, strategy }),
    export: (conversationId: string, content: string, format: 'docx' | 'pdf' | 'html') => ipcRenderer.invoke(channels.documents.export, { conversationId, content, format }),
  },
  clipboard: { readText: () => ipcRenderer.invoke(channels.clipboard.readText), writeText: (value: string) => ipcRenderer.invoke(channels.clipboard.writeText, value) },
}

contextBridge.exposeInMainWorld('nocturne', nocturneApi)

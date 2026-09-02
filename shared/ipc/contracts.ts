import type { AgentMode, Artifact, Attachment, AgentEvent, AppSettings, BuildRollbackStatus, CodexAccountStatus, CollectionPage, Conversation, DocumentUpdatePreview, FilePreview, GitInfo, Message, MessagePage, RendererPerformanceStats, Suggestion, SuggestionStatus, Workspace, WorkspaceChangeEvent, WorkspaceMemory } from '../types'
import type { DiscoveryExclusion, ProjectExport, ProjectImport, ProjectIndexFile, ProjectIndexStatus, ProjectIndexSummary, ProjectSymbol, StackEvidence, ValidationKind, ValidationRun } from '../codeIntelligence'
import type { ReviewComparison } from '../suggestions'
import type { BrainMemory, BrainMemoryHistoryEntry, BrainMemoryKind, BrainMemoryScope, BrainMemoryStatus, UpdateBrainMemoryInput } from '../brainMemory'
import type { ProviderAvailability, ProviderDiagnostic } from '../ai/provider'
import type {
  ProviderConfigurationErrorCode,
  ProviderConfigurationInput,
  ProviderConfigurationSummary,
} from '../ai/providerConfiguration'
import type { ModelDescriptor } from '../ai/model'
import type { WorkspaceModelBindings } from '../ai/bindings'
import type { CodexModel } from '../codexModels'
import type { JsonValue } from '../json'
import type { AgentStatusEvent } from '../agentLifecycle'

export interface ProviderConfigurationIpcError {
  code: ProviderConfigurationErrorCode
  message: string
  availability?: ProviderAvailability
}

export type IpcResult<T, E extends { message: string } = { message: string }> =
  | { ok: true; value: T }
  | { ok: false; error: E }

export type ProviderConfigurationIpcResult<T> = IpcResult<T, ProviderConfigurationIpcError>

export type ModelIpcErrorCode =
  | 'invalid-request'
  | 'not-found'
  | 'workspace-not-authorized'
  | 'operation-failed'

export type ModelIpcResult<T> = IpcResult<T, { code: ModelIpcErrorCode; message: string }>

export interface NocturneApi {
  workspace: { select(expectedWorkspace?: string): Promise<string | null>; validate(value: string): Promise<string | null>; list(): Promise<Workspace[]>; remove(value: string): Promise<void>; favorite(value: string, favorite: boolean): Promise<void>; openTool(value: string, tool: 'editor' | 'terminal'): Promise<void>; watch(value: string | null): Promise<void>; onChanged(listener: (event: WorkspaceChangeEvent) => void): () => void }
  projectIndex: {
    status(workspace: string): Promise<ProjectIndexStatus | null>
    start(workspace: string): Promise<void>
    cancel(workspace: string): Promise<boolean>
    retry(workspace: string): Promise<void>
    summary(workspace: string): Promise<ProjectIndexSummary>
    files(workspace: string, limit?: number): Promise<ProjectIndexFile[]>
    symbols(workspace: string, query?: string, limit?: number): Promise<ProjectSymbol[]>
    imports(workspace: string, relativePath?: string): Promise<ProjectImport[]>
    exports(workspace: string, relativePath?: string): Promise<ProjectExport[]>
    stack(workspace: string): Promise<StackEvidence[]>
    exclusions(workspace: string): Promise<DiscoveryExclusion[]>
    onStatus(listener: (status: ProjectIndexStatus) => void): () => void
  }
  validation: {
    run(workspace: string, kind: ValidationKind): Promise<ValidationRun>
    cancel(workspace: string): Promise<boolean>
    list(workspace: string, limit?: number): Promise<ValidationRun[]>
    latest(workspace: string): Promise<ValidationRun | null>
    onStatus(listener: (run: ValidationRun) => void): () => void
  }
  conversations: { list(): Promise<Conversation[]>; page(offset?: number, limit?: number): Promise<CollectionPage<Conversation>>; create(workspace: string): Promise<Conversation>; messages(id: string): Promise<Message[]>; messagePage(id: string, offset?: number, limit?: number): Promise<MessagePage>; delete(id: string): Promise<void> }
  ai: { send(conversationId: string, prompt: string, attachments?: string[], mode?: AgentMode): Promise<void>; cancel(conversationId: string): Promise<void>; saveAssistant(conversationId: string, content: string, metadata?: JsonValue): Promise<Message>; approve(key: string, accepted: boolean, forSession?: boolean): Promise<void>; rollbackStatus(conversationId: string): Promise<BuildRollbackStatus>; rollback(conversationId: string): Promise<{ restored: string[] } | null>; onEvent(listener: (event: AgentEvent) => void): () => void; onStatus(listener: (status: AgentStatusEvent) => void): () => void }
  codex: { status(): Promise<CodexAccountStatus>; login(): Promise<CodexAccountStatus>; logout(): Promise<CodexAccountStatus>; models(): Promise<CodexModel[]> }
  files: { attach(conversationId: string): Promise<Attachment[]>; open(conversationId: string, filePath: string, action: 'file' | 'folder' | 'editor'): Promise<void>; preview(conversationId: string, filePath: string): Promise<FilePreview> }
  memory: { get(conversationId: string): Promise<WorkspaceMemory>; set(conversationId: string, content: string, rules: string): Promise<WorkspaceMemory> }
  brain: {
    page(conversationId: string, offset?: number, limit?: number, query?: string, status?: BrainMemoryStatus): Promise<CollectionPage<BrainMemory>>
    history(conversationId: string, memoryId: string): Promise<BrainMemoryHistoryEntry[]>
    create(conversationId: string, value: { kind: BrainMemoryKind; scope: BrainMemoryScope; content: string }): Promise<BrainMemory>
    update(conversationId: string, memoryId: string, value: Omit<UpdateBrainMemoryInput, 'conversationId'>): Promise<BrainMemory>
    delete(conversationId: string, memoryId: string): Promise<{ deleted: true }>
    extract(conversationId: string, content: string): Promise<{ memories: BrainMemory[]; content: string; warning?: string }>
  }
  artifacts: { list(conversationId: string): Promise<Artifact[]>; page(conversationId: string, offset?: number, limit?: number): Promise<CollectionPage<Artifact>>; delete(conversationId: string, artifactId: string): Promise<{ deleted: true }> }
  suggestions: { list(conversationId: string): Promise<Suggestion[]>; page(conversationId: string, offset?: number, limit?: number): Promise<CollectionPage<Suggestion>>; create(conversationId: string, content: string): Promise<{ suggestions: Suggestion[]; content: string; comparison?: ReviewComparison; warning?: string }>; status(conversationId: string, suggestionId: string, status: SuggestionStatus, result?: string): Promise<Suggestion> }
  data: { export(): Promise<string | null>; import(): Promise<boolean> }
  diagnostics: { openLogs(): Promise<string>; copy(): Promise<string>; export(): Promise<string | null>; rendererError(value: { type: 'error' | 'unhandledRejection'; message: string; stack?: string }): Promise<void>; rendererStats(value: RendererPerformanceStats): Promise<void> }
  settings: { get(): Promise<AppSettings>; set(settings: Partial<AppSettings>): Promise<AppSettings> }
  providers: {
    list(): Promise<ProviderConfigurationSummary[]>
    create(configuration: ProviderConfigurationInput, credential?: string): Promise<ProviderConfigurationSummary>
    update(id: string, configuration: ProviderConfigurationInput, options?: { credential?: string; clearCredential?: boolean }): Promise<ProviderConfigurationSummary>
    remove(id: string): Promise<boolean>
    testConnection(id: string): Promise<ProviderAvailability>
    diagnose(id: string): Promise<ProviderDiagnostic>
  }
  models: {
    list(): Promise<ModelDescriptor[]>
    refresh(providerId: string): Promise<{ status: 'applied' | 'superseded'; models: ModelDescriptor[] }>
    bindings(workspaceId: string): Promise<WorkspaceModelBindings | null>
    setBindings(bindings: WorkspaceModelBindings): Promise<WorkspaceModelBindings>
  }
  git: { status(conversationId: string): Promise<GitInfo>; commit(conversationId: string, message: string, files: string[]): Promise<{ output: string }> }
  documents: { prepareMarkdown(conversationId: string, content: string, name?: string): Promise<DocumentUpdatePreview | null>; applyMarkdown(conversationId: string, preview: DocumentUpdatePreview, strategy: 'append' | 'replace'): Promise<{ target: string; strategy: 'append' | 'replace' } | null>; export(conversationId: string, content: string, format: 'docx' | 'pdf' | 'html'): Promise<string | null> }
  clipboard: { readText(): Promise<string>; writeText(value: string): Promise<void> }
}

declare global { interface Window { nocturne: NocturneApi } }

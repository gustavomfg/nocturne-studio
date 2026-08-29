import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type {
  BrainMemory,
  BrainMemoryCandidate,
  BrainMemoryHistoryEntry,
  CreateBrainMemoryInput,
  UpdateBrainMemoryInput,
} from '../../shared/brainMemory'
import type {
  Suggestion,
  SuggestionInput,
  SuggestionReconciliation,
  SuggestionStatus,
} from '../../shared/suggestions'
import { DatabaseRuntime, type DatabaseOperationObserver } from './DatabaseRuntime'
import { ProviderConfigurationRepository } from './ProviderConfigurationRepository'
import { ModelCatalogRepository } from './ModelCatalogRepository'
import { WorkspaceModelBindingRepository } from './WorkspaceModelBindingRepository'
import { ConversationRepository, type ConversationRow, type MessageRow } from './ConversationRepository'
import { ArtifactRepository } from './ArtifactRepository'
import { SettingsRepository } from './SettingsRepository'
import { WorkspaceMemoryRepository } from './WorkspaceMemoryRepository'
import { WorkspaceRepository, type WorkspaceRow } from './WorkspaceRepository'
import { BrainMemoryRepository } from './BrainMemoryRepository'
import { SuggestionRepository } from './SuggestionRepository'
import { BackupRepository, type DatabaseImportData } from './BackupRepository'

export type { ConversationRow, MessageRow } from './ConversationRepository'
export type { ArtifactRow } from './ArtifactRepository'
export type { WorkspaceRow } from './WorkspaceRepository'
export type { DatabaseImportData } from './BackupRepository'

/** Compatibility façade for the main process while persistence is split by domain. */
export class LocalDatabase {
  private db: Database.Database
  private readonly runtime: DatabaseRuntime
  readonly conversations: ConversationRepository
  readonly artifacts: ArtifactRepository
  readonly settings: SettingsRepository
  readonly workspaceMemory: WorkspaceMemoryRepository
  readonly workspaces: WorkspaceRepository
  readonly brainMemories: BrainMemoryRepository
  readonly suggestions: SuggestionRepository
  readonly backup: BackupRepository
  readonly providerConfigurations: ProviderConfigurationRepository
  readonly modelCatalog: ModelCatalogRepository
  readonly workspaceModelBindings: WorkspaceModelBindingRepository

  constructor(userDataPath: string) {
    this.runtime = new DatabaseRuntime(userDataPath)
    this.db = this.runtime.db
    this.conversations = new ConversationRepository(this.db)
    this.artifacts = new ArtifactRepository(this.db)
    this.settings = new SettingsRepository(this.db)
    this.workspaceMemory = new WorkspaceMemoryRepository(this.db)
    this.providerConfigurations = new ProviderConfigurationRepository(this.db)
    this.modelCatalog = new ModelCatalogRepository(this.db)
    this.workspaceModelBindings = new WorkspaceModelBindingRepository(this.db)
    this.workspaces = new WorkspaceRepository(this.db, this.workspaceModelBindings)
    this.brainMemories = new BrainMemoryRepository(this.db, (id) => this.conversations.get(id))
    this.suggestions = new SuggestionRepository(this.db)
    this.backup = new BackupRepository(this.db, this.settings, () => this.runtime.cleanupOrphans())
  }

  runInTransaction<T>(operation: () => T): T {
    return this.runtime.runInTransaction(operation)
  }

  setOperationObserver(observer: DatabaseOperationObserver | undefined) {
    this.runtime.setOperationObserver(observer)
  }

  listConversations() {
    return this.runtime.measure('conversations.list', () => this.conversations.list())
  }

  listConversationPage(offset = 0, limit = 100) {
    return this.runtime.measure('conversations.page', () => this.conversations.page(offset, limit))
  }

  getConversation(id: string) {
    return this.runtime.measure('conversations.get', () => this.conversations.get(id))
  }

  createRecoverySnapshot(retain = 5) {
    return this.runtime.createRecoverySnapshot(retain)
  }

  createConversation(workspace: string): ConversationRow {
    this.workspaces.touch(workspace)
    return this.conversations.create(workspace)
  }

  listWorkspaces(): WorkspaceRow[] {
    return this.runtime.measure('workspaces.list', () => this.workspaces.list())
  }

  touchWorkspace(workspace: string) {
    this.workspaces.touch(workspace)
  }

  relocateWorkspace(source: string, destination: string) {
    this.workspaces.relocate(source, destination)
  }

  removeWorkspace(workspace: string) {
    this.workspaces.remove(workspace)
  }

  setWorkspaceFavorite(workspace: string, favorite: boolean) {
    this.workspaces.setFavorite(workspace, favorite)
  }

  getSettings() {
    return this.runtime.measure('settings.get', () => this.settings.get())
  }

  setSettings(values: Record<string, string>) {
    this.settings.set(values)
  }

  getWorkspaceMemory(workspace: string) {
    return this.runtime.measure('workspaceMemory.get', () => this.workspaceMemory.get(workspace))
  }

  setWorkspaceMemory(workspace: string, content: string) {
    return this.workspaceMemory.set(workspace, content)
  }

  createBrainMemory(workspaceId: string, value: CreateBrainMemoryInput): BrainMemory {
    return this.brainMemories.create(workspaceId, value)
  }

  updateBrainMemory(id: string, workspaceId: string, value: UpdateBrainMemoryInput): BrainMemory {
    return this.brainMemories.update(id, workspaceId, value)
  }

  listBrainMemoryHistory(id: string, workspaceId: string): BrainMemoryHistoryEntry[] {
    return this.brainMemories.listHistory(id, workspaceId)
  }

  deleteBrainMemory(id: string, workspaceId: string) {
    return this.brainMemories.delete(id, workspaceId)
  }

  getBrainMemory(id: string, workspaceId: string): BrainMemory | null {
    return this.brainMemories.get(id, workspaceId)
  }

  findEquivalentBrainMemory(
    workspaceId: string,
    scope: BrainMemory['scope'],
    conversationId: string | null,
    content: string,
  ): BrainMemory | null {
    return this.brainMemories.findEquivalent(workspaceId, scope, conversationId, content)
  }

  createBrainMemoryCandidates(
    workspaceId: string,
    currentConversationId: string,
    candidates: BrainMemoryCandidate[],
  ) {
    return this.brainMemories.createCandidates(workspaceId, currentConversationId, candidates)
  }

  listBrainMemoryPage(
    workspaceId: string,
    offset = 0,
    limit = 50,
    query = '',
    status?: BrainMemory['status'],
  ) {
    return this.runtime.measure('brainMemories.page', () => this.brainMemories.listPage(
      workspaceId,
      offset,
      limit,
      query,
      status,
    ))
  }

  retrieveBrainMemories(workspaceId: string, conversationId: string, query: string, limit = 8): BrainMemory[] {
    return this.runtime.measure('brainMemories.retrieve', () => this.brainMemories.retrieve(
      workspaceId,
      conversationId,
      query,
      limit,
    ))
  }

  markBrainMemoriesUsed(ids: string[]) {
    this.brainMemories.markUsed(ids)
  }

  listArtifacts(conversationId: string) {
    return this.runtime.measure('artifacts.list', () => this.artifacts.list(conversationId))
  }

  listArtifactPage(conversationId: string, offset = 0, limit = 50) {
    return this.runtime.measure('artifacts.page', () => this.artifacts.page(conversationId, offset, limit))
  }

  addArtifact(
    conversationId: string,
    workspace: string,
    type: string,
    title: string,
    filePath?: string | null,
    content?: string | null,
    metadata?: unknown,
  ) {
    return this.artifacts.add(conversationId, workspace, type, title, filePath, content, metadata)
  }

  saveAssistantTurn(
    conversationId: string,
    workspace: string,
    content: string,
    metadata: unknown,
    artifacts: Array<{
      type: string
      title: string
      filePath?: string | null
      content?: string | null
      metadata?: unknown
    }> = [],
  ) {
    return this.runtime.runInTransaction(() => {
      const message = this.conversations.insertMessage(conversationId, 'assistant', content, metadata)
      this.artifacts.add(
        conversationId,
        workspace,
        'markdown',
        `Resposta · ${new Date().toLocaleString()}`,
        null,
        content,
      )
      for (const artifact of artifacts) {
        this.artifacts.add(
          conversationId,
          workspace,
          artifact.type,
          artifact.title,
          artifact.filePath,
          artifact.content,
          artifact.metadata,
        )
      }
      return message
    })
  }

  deleteArtifact(id: string, conversationId: string) {
    return this.artifacts.delete(id, conversationId)
  }

  recordApproval(key: string, accepted: boolean, command?: string, risk?: string) {
    this.db.prepare(`INSERT INTO approval_audit(
      id,approval_key,decision,command,risk,created_at
    ) VALUES(?,?,?,?,?,?)`).run(
      randomUUID(),
      key,
      accepted ? 'accepted' : 'declined',
      command?.slice(0, 4_000) ?? null,
      risk ?? null,
      new Date().toISOString(),
    )
  }

  listSuggestions(conversationId: string): Suggestion[] {
    return this.runtime.measure('suggestions.list', () => this.suggestions.list(conversationId))
  }

  listSuggestionPage(conversationId: string, offset = 0, limit = 50) {
    return this.runtime.measure('suggestions.page', () => this.suggestions.page(
      conversationId,
      offset,
      limit,
    ))
  }

  getSuggestion(id: string, conversationId?: string): Suggestion | null {
    return this.suggestions.get(id, conversationId)
  }

  addSuggestion(conversationId: string, workspaceId: string, value: SuggestionInput): Suggestion {
    return this.suggestions.add(conversationId, workspaceId, value)
  }

  reconcileSuggestions(
    conversationId: string,
    workspaceId: string,
    values: SuggestionInput[],
  ): SuggestionReconciliation {
    return this.suggestions.reconcile(conversationId, workspaceId, values)
  }

  setSuggestionStatus(id: string, status: SuggestionStatus, result?: string): Suggestion {
    return this.suggestions.setStatus(id, status, result)
  }

  exportData() {
    return this.backup.exportData()
  }

  getExportMetrics() {
    return this.backup.getExportMetrics()
  }

  importData(data: DatabaseImportData, scope: 'full' | 'project-data' = 'full') {
    this.backup.importData(data, scope)
  }

  renameFromPrompt(id: string, prompt: string) {
    this.conversations.renameFromPrompt(id, prompt)
  }

  setConversationCodexThread(id: string, threadId: string | null) {
    this.conversations.setCodexThread(id, threadId)
  }

  deleteConversation(id: string) {
    this.conversations.delete(id)
  }

  listMessages(conversationId: string) {
    return this.runtime.measure('messages.list', () => this.conversations.listMessages(conversationId))
  }

  listRecentMessages(conversationId: string, limit = 100) {
    return this.runtime.measure('messages.recent', () => this.conversations.listRecentMessages(conversationId, limit))
  }

  listMessagePage(conversationId: string, offset = 0, limit = 100) {
    return this.runtime.measure('messages.page', () => this.conversations.pageMessages(conversationId, offset, limit))
  }

  addMessage(conversationId: string, role: MessageRow['role'], content: string, metadata?: unknown) {
    return this.conversations.addMessage(conversationId, role, content, metadata)
  }

  close() {
    this.runtime.close()
  }
}

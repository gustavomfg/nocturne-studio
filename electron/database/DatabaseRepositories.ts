import type Database from 'better-sqlite3'
import { ApprovalRepository } from './ApprovalRepository'
import { ArtifactRepository } from './ArtifactRepository'
import { BackupRepository } from './BackupRepository'
import { BrainMemoryRepository } from './BrainMemoryRepository'
import { ConversationRepository } from './ConversationRepository'
import { DatabaseRuntime } from './DatabaseRuntime'
import { ModelCatalogRepository } from './ModelCatalogRepository'
import { ProviderConfigurationRepository } from './ProviderConfigurationRepository'
import { SettingsRepository } from './SettingsRepository'
import { SuggestionRepository } from './SuggestionRepository'
import { WorkspaceMemoryRepository } from './WorkspaceMemoryRepository'
import { WorkspaceModelBindingRepository } from './WorkspaceModelBindingRepository'
import { WorkspaceRepository } from './WorkspaceRepository'
import { ProjectIndexRepository } from './ProjectIndexRepository'
import { ValidationRepository } from './ValidationRepository'
import type { DatabaseTransactionRunner } from './DatabaseTransaction'

export interface DatabaseRepositories {
  approvals: ApprovalRepository
  conversations: ConversationRepository
  artifacts: ArtifactRepository
  settings: SettingsRepository
  workspaceMemory: WorkspaceMemoryRepository
  workspaces: WorkspaceRepository
  brainMemories: BrainMemoryRepository
  suggestions: SuggestionRepository
  backup: BackupRepository
  providerConfigurations: ProviderConfigurationRepository
  modelCatalog: ModelCatalogRepository
  workspaceModelBindings: WorkspaceModelBindingRepository
  projectIndex: ProjectIndexRepository
  validation: ValidationRepository
}

/** Composes domain repositories around one runtime-owned SQLite connection. */
export function createDatabaseRepositories(runtime: DatabaseRuntime): DatabaseRepositories {
  const database: Database.Database = runtime.db
  const transactions: DatabaseTransactionRunner = {
    run: (operation, callback) => runtime.runInTransaction(callback, operation),
  }
  const conversations = new ConversationRepository(database, transactions)
  const settings = new SettingsRepository(database, transactions)
  const workspaceModelBindings = new WorkspaceModelBindingRepository(database)

  return {
    approvals: new ApprovalRepository(database),
    conversations,
    artifacts: new ArtifactRepository(database),
    settings,
    workspaceMemory: new WorkspaceMemoryRepository(database),
    workspaces: new WorkspaceRepository(database, workspaceModelBindings, transactions),
    brainMemories: new BrainMemoryRepository(database, (id) => conversations.get(id), transactions),
    suggestions: new SuggestionRepository(database, transactions),
    backup: new BackupRepository(database, settings, () => runtime.cleanupOrphans(), transactions),
    providerConfigurations: new ProviderConfigurationRepository(database),
    modelCatalog: new ModelCatalogRepository(database, transactions),
    workspaceModelBindings,
    projectIndex: new ProjectIndexRepository(database, transactions),
    validation: new ValidationRepository(database, transactions),
  }
}

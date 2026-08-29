import type { BrowserWindow } from 'electron'
import { z } from 'zod'
import type { WorkspaceModelBindings } from '../../shared/ai/bindings'
import { workspaceModelBindingsSchema } from '../../shared/ai/bindingSchemas'
import type { ModelDescriptor } from '../../shared/ai/model'
import { MODEL_LIMITS } from '../../shared/ai/model'
import { modelDescriptorSchema } from '../../shared/ai/modelSchemas'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import type { ModelIpcResult } from '../../shared/ipc/contracts'
import { modelProviderIdSchema } from '../../shared/ipc/schemas'
import type { ModelCatalogRefreshResult } from '../ai/ModelCatalogService'
import { ProviderRegistryError } from '../ai/ProviderRegistry'
import type { LocalDatabase } from '../database/Database'
import { getAuthorizedWorkspace } from './conversationAccess'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'

export interface ModelCatalogOperations {
  list(): ModelDescriptor[]
  refresh(providerId: string): Promise<ModelCatalogRefreshResult>
}

const workspaceIdSchema = z.object({
  workspaceId: z.string().trim().min(1).max(MODEL_LIMITS.identifierCharacters),
}).strict()

const refreshResultSchema = z.object({
  status: z.enum(['applied', 'superseded']),
  models: z.array(modelDescriptorSchema).max(25_000),
}).strict()

export function registerModelIpc(
  win: BrowserWindow,
  database: LocalDatabase,
  catalog: ModelCatalogOperations,
  registrar?: SafeIpcMain,
) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar

  ipcMain.handle(IPC_CHANNELS.models.list, () => execute(() =>
    z.array(modelDescriptorSchema).max(25_000).parse(catalog.list())))

  ipcMain.handle(IPC_CHANNELS.models.refresh, (_event, input: unknown) =>
    execute(async () => {
      const { providerId } = modelProviderIdSchema.parse(input)
      return refreshResultSchema.parse(await catalog.refresh(providerId))
    }))

  ipcMain.handle(IPC_CHANNELS.models.bindings, (_event, input: unknown) =>
    execute(() => {
      const { workspaceId } = workspaceIdSchema.parse(input)
      getAuthorizedWorkspace(database, workspaceId)
      const bindings = database.workspaceModelBindings.get(workspaceId)
      return bindings ? workspaceModelBindingsSchema.parse(bindings) : null
    }))

  ipcMain.handle(IPC_CHANNELS.models.setBindings, (_event, input: unknown) =>
    execute(() => {
      const bindings = workspaceModelBindingsSchema.parse(input)
      getAuthorizedWorkspace(database, bindings.workspaceId)
      return workspaceModelBindingsSchema.parse(
        database.workspaceModelBindings.set(bindings),
      ) as WorkspaceModelBindings
    }))

  return () => { if (ownsRegistrar) ipcMain.dispose() }
}

async function execute<T>(
  operation: () => T | Promise<T>,
): Promise<ModelIpcResult<T>> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        ok: false,
        error: {
          code: 'invalid-request',
          message: 'A requisição de modelos é inválida.',
        },
      }
    }
    if (error instanceof ProviderRegistryError && error.code === 'provider-not-found') {
      return {
        ok: false,
        error: { code: 'not-found', message: 'Provider não encontrado.' },
      }
    }
    if (error instanceof Error && error.message.startsWith('Workspace não autorizado.')) {
      return {
        ok: false,
        error: {
          code: 'workspace-not-authorized',
          message: error.message,
        },
      }
    }
    return {
      ok: false,
      error: {
        code: 'operation-failed',
        message: 'Não foi possível concluir a operação de modelos.',
      },
    }
  }
}

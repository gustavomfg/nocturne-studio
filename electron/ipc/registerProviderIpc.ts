import type { BrowserWindow } from 'electron'
import { z } from 'zod'
import type { ProviderAvailability, ProviderDiagnostic } from '../../shared/ai/provider'
import type {
  ProviderConfigurationSummary,
} from '../../shared/ai/providerConfiguration'
import { providerConfigurationSummarySchema } from '../../shared/ai/providerConfigurationSchemas'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import type { ProviderConfigurationIpcResult } from '../../shared/ipc/contracts'
import {
  providerConfigurationCreateSchema,
  providerConfigurationIdSchema,
  providerConfigurationUpdateSchema,
} from '../../shared/ipc/schemas'
import {
  ProviderConfigurationServiceError,
  type ProviderCredentialChange,
} from '../ai/ProviderConfigurationService'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'

export interface ProviderConfigurationOperations {
  list(): ProviderConfigurationSummary[]
  create(
    input: unknown,
    change?: ProviderCredentialChange,
  ): Promise<ProviderConfigurationSummary>
  update(
    id: string,
    input: unknown,
    change?: ProviderCredentialChange,
  ): Promise<ProviderConfigurationSummary>
  remove(id: string): Promise<boolean>
  testConnection(id: string): Promise<ProviderAvailability>
  diagnose(id: string): Promise<ProviderDiagnostic>
}

const availabilitySchema = z.object({
  status: z.enum([
    'not-configured',
    'validating',
    'available',
    'degraded',
    'offline',
    'authentication-required',
    'incompatible',
    'disabled',
  ]),
  message: z.string().max(2_000).optional(),
  checkedAt: z.string().datetime({ offset: true }).optional(),
}).strict()

const providerDefinitionSchema = z.object({
  id: z.string().min(1).max(512),
  displayName: z.string().min(1).max(500),
  source: z.enum(['local', 'remote']),
  protocol: z.string().min(1).max(200),
  version: z.string().max(200).optional(),
  capabilities: z.object({
    modelDiscovery: z.boolean(),
    streaming: z.boolean(),
    toolCalling: z.boolean(),
    cancellation: z.boolean(),
    authentication: z.enum(['none', 'optional', 'required']),
  }).strict(),
  limitations: z.object({
    requestTimeoutMs: z.object({ minimum: z.number().int().min(1), maximum: z.number().int().min(1) }).strict(),
    notes: z.array(z.string().max(1_000)).max(20),
  }).strict(),
}).strict()

const providerDiagnosticSchema = z.object({
  providerId: z.string().min(1).max(512),
  definition: providerDefinitionSchema,
  availability: availabilitySchema,
  connectivity: z.enum(['connected', 'unreachable', 'unknown']),
  authentication: z.enum(['not-required', 'configured', 'missing', 'rejected']),
  compatibility: z.enum(['compatible', 'incompatible', 'unknown']),
  latencyMs: z.number().int().min(0).max(600_000),
  checkedAt: z.string().datetime({ offset: true }),
  recentErrors: z.array(z.object({
    message: z.string().max(2_000),
    occurredAt: z.string().datetime({ offset: true }),
  }).strict()).max(5),
}).strict()

export function registerProviderIpc(
  win: BrowserWindow,
  service: ProviderConfigurationOperations,
  registrar?: SafeIpcMain,
) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar

  ipcMain.handle(IPC_CHANNELS.providers.list, () => execute(() =>
    z.array(providerConfigurationSummarySchema).parse(service.list())))

  ipcMain.handle(IPC_CHANNELS.providers.create, (_event, input: unknown) =>
    execute(async () => {
      const value = providerConfigurationCreateSchema.parse(input)
      return providerConfigurationSummarySchema.parse(
        await service.create(value.configuration, { credential: value.credential }),
      )
    }))

  ipcMain.handle(IPC_CHANNELS.providers.update, (_event, input: unknown) =>
    execute(async () => {
      const value = providerConfigurationUpdateSchema.parse(input)
      return providerConfigurationSummarySchema.parse(
        await service.update(value.id, value.configuration, {
          credential: value.credential,
          clearCredential: value.clearCredential,
        }),
      )
    }))

  ipcMain.handle(IPC_CHANNELS.providers.remove, (_event, input: unknown) =>
    execute(async () => {
      const value = providerConfigurationIdSchema.parse(input)
      return await service.remove(value.id)
    }))

  ipcMain.handle(IPC_CHANNELS.providers.testConnection, (_event, input: unknown) =>
    execute(async () => {
      const value = providerConfigurationIdSchema.parse(input)
      return availabilitySchema.parse(await service.testConnection(value.id))
    }))

  ipcMain.handle(IPC_CHANNELS.providers.diagnose, (_event, input: unknown) =>
    execute(async () => {
      const value = providerConfigurationIdSchema.parse(input)
      return providerDiagnosticSchema.parse(await service.diagnose(value.id))
    }))

  return () => { if (ownsRegistrar) ipcMain.dispose() }
}

async function execute<T>(
  operation: () => T | Promise<T>,
): Promise<ProviderConfigurationIpcResult<T>> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    if (error instanceof ProviderConfigurationServiceError) {
      const availability = error.availability
        ? availabilitySchema.safeParse(error.availability)
        : undefined
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message.slice(0, 2_000),
          ...(availability?.success
            ? { availability: availability.data }
            : {}),
        },
      }
    }
    return {
      ok: false,
      error: {
        code: error instanceof z.ZodError
          ? 'invalid-configuration'
          : 'operation-failed',
        message: error instanceof z.ZodError
          ? 'A requisição de configuração do Provider é inválida.'
          : 'Não foi possível concluir a operação do Provider.',
      },
    }
  }
}

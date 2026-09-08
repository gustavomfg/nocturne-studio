import type { ProviderAvailability, ProviderDefinition } from '../../shared/ai/provider'
import type {
  EmbeddingExecutionControl,
  EmbeddingRequest,
  EmbeddingResult,
} from '../../shared/ai/embedding'
import type {
  ProviderExecutionControl,
  ProviderExecutionRequest,
  ProviderExecutionResult,
} from '../../shared/ai/providerExecution'

export interface ProviderAdapter {
  readonly definition: ProviderDefinition
  getAvailability(): ProviderAvailability | Promise<ProviderAvailability>
  listModels(): readonly unknown[] | Promise<readonly unknown[]>
  execute(
    request: ProviderExecutionRequest,
    control: ProviderExecutionControl,
  ): ProviderExecutionResult | Promise<ProviderExecutionResult>
  embed?(
    request: EmbeddingRequest,
    control: EmbeddingExecutionControl,
  ): EmbeddingResult | Promise<EmbeddingResult>
  dispose?(): void | Promise<void>
}

export type ProviderRegistryErrorCode = 'duplicate-provider' | 'provider-not-found'

export class ProviderRegistryError extends Error {
  constructor(
    readonly code: ProviderRegistryErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderRegistryError'
  }
}

export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>()

  register(adapter: ProviderAdapter) {
    const { id } = adapter.definition
    if (this.adapters.has(id)) {
      throw new ProviderRegistryError('duplicate-provider', `Provider já registrado: ${id}`)
    }
    this.adapters.set(id, adapter)
  }

  async replace(adapter: ProviderAdapter): Promise<{
    replaced: boolean
    disposalError?: unknown
  }> {
    const previous = this.adapters.get(adapter.definition.id)
    this.adapters.set(adapter.definition.id, adapter)
    try {
      await previous?.dispose?.()
      return { replaced: Boolean(previous) }
    } catch (disposalError) {
      return { replaced: Boolean(previous), disposalError }
    }
  }

  list(): ProviderDefinition[] {
    return [...this.adapters.values()].map(({ definition }) => ({
      ...definition,
      capabilities: { ...definition.capabilities },
      limitations: {
        requestTimeoutMs: { ...definition.limitations.requestTimeoutMs },
        notes: [...definition.limitations.notes],
      },
    }))
  }

  resolve(providerId: string): ProviderAdapter {
    const adapter = this.adapters.get(providerId)
    if (!adapter) {
      throw new ProviderRegistryError('provider-not-found', `Provider não registrado: ${providerId}`)
    }
    return adapter
  }

  async getAvailability(providerId: string): Promise<ProviderAvailability> {
    return this.resolve(providerId).getAvailability()
  }

  async unregister(providerId: string): Promise<boolean> {
    const adapter = this.adapters.get(providerId)
    if (!adapter) return false

    this.adapters.delete(providerId)
    await adapter.dispose?.()
    return true
  }

  async dispose(): Promise<void> {
    const adapters = [...this.adapters.values()]
    this.adapters.clear()
    await Promise.all(adapters.map((adapter) => adapter.dispose?.()))
  }
}

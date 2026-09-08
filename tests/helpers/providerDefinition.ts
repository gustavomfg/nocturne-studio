import type { ProviderDefinition, ProviderSource } from '../../shared/ai/provider'

export function providerDefinition(id: string, source: ProviderSource = 'remote'): ProviderDefinition {
  return {
    id,
    displayName: id,
    source,
    protocol: 'test',
    version: '1',
    capabilities: {
      modelDiscovery: true,
      embeddings: false,
      streaming: true,
      toolCalling: false,
      cancellation: true,
      authentication: 'none',
    },
    limitations: {
      requestTimeoutMs: { minimum: 1_000, maximum: 120_000 },
      notes: [],
    },
  }
}

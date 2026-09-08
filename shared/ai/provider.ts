export type ProviderSource = 'local' | 'remote'
export type ProviderAuthenticationMode = 'none' | 'optional' | 'required'

export type ProviderAvailabilityStatus =
  | 'not-configured'
  | 'validating'
  | 'available'
  | 'degraded'
  | 'offline'
  | 'authentication-required'
  | 'incompatible'
  | 'disabled'

export interface ProviderDefinition {
  id: string
  displayName: string
  source: ProviderSource
  protocol: string
  version?: string
  capabilities: {
    modelDiscovery: boolean
    embeddings: boolean
    streaming: boolean
    toolCalling: boolean
    cancellation: boolean
    authentication: ProviderAuthenticationMode
  }
  limitations: {
    requestTimeoutMs: { minimum: number; maximum: number }
    notes: string[]
  }
}

export interface ProviderAvailability {
  status: ProviderAvailabilityStatus
  message?: string
  checkedAt?: string
}

export interface ProviderDiagnosticError {
  message: string
  occurredAt: string
}

export interface ProviderDiagnostic {
  providerId: string
  definition: ProviderDefinition
  availability: ProviderAvailability
  connectivity: 'connected' | 'unreachable' | 'unknown'
  authentication: 'not-required' | 'configured' | 'missing' | 'rejected'
  compatibility: 'compatible' | 'incompatible' | 'unknown'
  latencyMs: number
  checkedAt: string
  recentErrors: ProviderDiagnosticError[]
}

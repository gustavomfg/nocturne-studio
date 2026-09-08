import { describe, expect, it } from 'vitest'
import {
  ProviderConfigurationService,
  ProviderConfigurationServiceError,
  type ConfiguredProviderAdapterFactory,
  type ProviderConfigurationStore,
  type ProviderCredentialStore,
} from '../electron/ai/ProviderConfigurationService'
import {
  ProviderRegistry,
  type ProviderAdapter,
} from '../electron/ai/ProviderRegistry'
import type {
  ProviderConfigurationInput,
  ProviderConfigurationSummary,
} from '../shared/ai/providerConfiguration'
import type { ProviderAvailability } from '../shared/ai/provider'
import { providerDefinition } from './helpers/providerDefinition'

const ids = [
  '9ba7e635-8746-48bd-a8e9-4609ff1690cb',
  'f79c1a83-df07-4ff0-91d0-cf639fd0845e',
  'c8c57256-39b7-4366-988c-b0b261ee62c2',
]

const remoteConfiguration: ProviderConfigurationInput = {
  providerType: 'openai-compatible',
  displayName: 'Remote Provider',
  source: 'remote',
  baseUrl: 'https://provider.example/v1',
  enabled: true,
  requiresAuthentication: true,
  timeoutMs: 30_000,
}

class MemoryConfigurationStore implements ProviderConfigurationStore {
  records = new Map<string, ProviderConfigurationSummary>()
  references = new Map<string, string | null>()
  failUpdate = false
  private nextId = 0

  list() {
    return [...this.records.values()]
  }

  get(id: string) {
    return this.records.get(id) ?? null
  }

  create(input: unknown, credentialReference: string | null = null) {
    const id = ids[this.nextId++]
    const timestamp = new Date(1_700_000_000_000 + this.nextId).toISOString()
    const row = {
      id,
      ...(input as ProviderConfigurationInput),
      credentialConfigured: Boolean(credentialReference),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.records.set(id, row)
    this.references.set(id, credentialReference)
    return row
  }

  update(id: string, input: unknown, credentialReference?: string | null) {
    if (this.failUpdate) throw new Error('database secret path')
    const current = this.records.get(id)
    if (!current) throw new Error('missing')
    if (credentialReference !== undefined) this.references.set(id, credentialReference)
    const row = {
      ...current,
      ...(input as ProviderConfigurationInput),
      credentialConfigured: Boolean(this.references.get(id)),
      updatedAt: new Date(Date.parse(current.updatedAt) + 1).toISOString(),
    }
    this.records.set(id, row)
    return row
  }

  getCredentialReference(id: string) {
    if (!this.records.has(id)) throw new Error('missing')
    return this.references.get(id) ?? null
  }

  listCredentialReferences() {
    return [...this.references.values()].filter(
      (value): value is string => value !== null,
    )
  }

  delete(id: string) {
    if (!this.records.has(id)) return { deleted: false, credentialReference: null }
    const credentialReference = this.references.get(id) ?? null
    this.records.delete(id)
    this.references.delete(id)
    return { deleted: true, credentialReference }
  }
}

class MemoryCredentialStore implements ProviderCredentialStore {
  entries = new Map<string, string>()
  private nextId = 0

  async create(secret: string) {
    const reference = ids[this.nextId++]
    this.entries.set(reference, secret)
    return reference
  }

  async resolve(reference: string) {
    return this.entries.get(reference)
  }

  async delete(reference: string) {
    return this.entries.delete(reference)
  }

  async prune(allowedReferences: readonly string[]) {
    const allowed = new Set(allowedReferences)
    let removed = 0
    for (const reference of this.entries.keys()) {
      if (allowed.has(reference)) continue
      this.entries.delete(reference)
      removed += 1
    }
    return removed
  }
}

class FakeFactory implements ConfiguredProviderAdapterFactory {
  availability: ProviderAvailability = { status: 'available' }
  availabilityError?: Error
  created: FakeAdapter[] = []
  resolvedCredentials: Array<string | undefined> = []

  normalize(input: unknown) {
    const value = input as ProviderConfigurationInput
    if (!value.baseUrl.startsWith('https://') && value.source === 'remote') {
      throw new Error('invalid endpoint with secret')
    }
    return { ...value, baseUrl: value.baseUrl.replace(/\/$/, '') }
  }

  create(
    id: string,
    input: ProviderConfigurationInput,
    resolveCredential: () => Promise<string | undefined>,
  ) {
    const adapter = new FakeAdapter(
      id,
      input,
      resolveCredential,
      () => {
        if (this.availabilityError) throw this.availabilityError
        return this.availability
      },
      (credential) => this.resolvedCredentials.push(credential),
    )
    this.created.push(adapter)
    return adapter
  }
}

class FakeAdapter implements ProviderAdapter {
  readonly definition
  disposed = false

  constructor(
    id: string,
    private readonly input: ProviderConfigurationInput,
    private readonly resolveCredential: () => Promise<string | undefined>,
    private readonly availability: () => ProviderAvailability,
    private readonly recordCredential: (credential: string | undefined) => void,
  ) {
    this.definition = {
      ...providerDefinition(id, input.source),
      displayName: input.displayName,
      capabilities: {
        ...providerDefinition(id, input.source).capabilities,
        authentication: input.requiresAuthentication ? 'required' as const : 'none' as const,
      },
    }
  }

  async getAvailability() {
    const credential = await this.resolveCredential()
    this.recordCredential(credential)
    return this.input.enabled ? this.availability() : { status: 'disabled' as const }
  }

  listModels() {
    return []
  }

  execute() {
    return { finishReason: 'stop' as const }
  }

  dispose() {
    this.disposed = true
  }
}

function setup() {
  const configurations = new MemoryConfigurationStore()
  const credentials = new MemoryCredentialStore()
  const providers = new ProviderRegistry()
  const factory = new FakeFactory()
  const service = new ProviderConfigurationService(
    configurations,
    credentials,
    providers,
    factory,
  )
  return { configurations, credentials, providers, factory, service }
}

describe('ProviderConfigurationService', () => {
  it('valida, protege e registra uma configuração habilitada', async () => {
    const { configurations, credentials, factory, providers, service } = setup()
    const summary = await service.create(remoteConfiguration, {
      credential: 'provider-secret',
    })

    expect(summary).toMatchObject({
      credentialConfigured: true,
      baseUrl: 'https://provider.example/v1',
    })
    expect(configurations.getCredentialReference(summary.id)).toBe(ids[0])
    expect(credentials.entries.get(ids[0])).toBe('provider-secret')
    expect(factory.resolvedCredentials).toEqual(['provider-secret'])
    await expect(providers.getAvailability(summary.id)).resolves.toEqual({
      status: 'available',
    })
    expect(factory.resolvedCredentials).toEqual([
      'provider-secret',
      'provider-secret',
    ])
  })

  it('não persiste quando a validação falha e não expõe a credencial', async () => {
    const { configurations, credentials, factory, service } = setup()
    factory.availability = {
      status: 'authentication-required',
      message: 'Credencial recusada.',
    }

    await expect(service.create(remoteConfiguration, {
      credential: 'secret-that-must-not-leak',
    })).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ProviderConfigurationServiceError)
      expect(error).toMatchObject({
        code: 'validation-failed',
        message: expect.not.stringContaining('secret-that-must-not-leak'),
      })
      return true
    })
    expect(configurations.list()).toEqual([])
    expect(credentials.entries.size).toBe(0)
  })

  it('normaliza exceções nativas durante a validação', async () => {
    const { configurations, credentials, factory, service } = setup()
    factory.availabilityError = new Error('Bearer native-secret')

    await expect(service.create(remoteConfiguration, {
      credential: 'submitted-secret',
    })).rejects.toMatchObject({
      code: 'validation-failed',
      message: 'Não foi possível validar a conexão do Provider.',
    })
    expect(configurations.list()).toEqual([])
    expect(credentials.entries.size).toBe(0)
  })

  it('salva drafts desabilitados sem rede e exige credencial ao habilitar', async () => {
    const { factory, service } = setup()
    const draft = await service.create({
      ...remoteConfiguration,
      enabled: false,
    })
    expect(draft).toMatchObject({
      enabled: false,
      credentialConfigured: false,
    })
    expect(factory.resolvedCredentials).toEqual([])

    await expect(service.update(draft.id, remoteConfiguration)).rejects.toMatchObject({
      code: 'credential-required',
    })
  })

  it('rotaciona por nova referência e remove o ciphertext anterior', async () => {
    const { configurations, credentials, factory, providers, service } = setup()
    const created = await service.create(remoteConfiguration, {
      credential: 'old-secret',
    })
    const previousAdapter = providers.resolve(created.id) as FakeAdapter
    factory.resolvedCredentials.length = 0

    const updated = await service.update(created.id, {
      ...remoteConfiguration,
      displayName: 'Rotated Provider',
    }, { credential: 'new-secret' })

    expect(updated).toMatchObject({
      displayName: 'Rotated Provider',
      credentialConfigured: true,
    })
    expect(configurations.getCredentialReference(created.id)).toBe(ids[1])
    expect(credentials.entries.has(ids[0])).toBe(false)
    expect(credentials.entries.get(ids[1])).toBe('new-secret')
    expect(previousAdapter.disposed).toBe(true)
    await providers.getAvailability(created.id)
    expect(factory.resolvedCredentials).toEqual(['new-secret', 'new-secret'])
  })

  it('compensa a nova credencial quando a atualização SQLite falha', async () => {
    const { configurations, credentials, providers, service } = setup()
    const created = await service.create(remoteConfiguration, {
      credential: 'old-secret',
    })
    configurations.failUpdate = true

    await expect(service.update(created.id, {
      ...remoteConfiguration,
      displayName: 'Should fail',
    }, { credential: 'new-secret' })).rejects.toMatchObject({
      code: 'operation-failed',
      message: expect.not.stringContaining('secret'),
    })
    expect(configurations.getCredentialReference(created.id)).toBe(ids[0])
    expect(credentials.entries).toEqual(new Map([[ids[0], 'old-secret']]))
    expect(providers.resolve(created.id).definition.displayName).toBe('Remote Provider')
  })

  it('remove configuração, adapter e credencial de forma idempotente', async () => {
    const { credentials, providers, service } = setup()
    const created = await service.create(remoteConfiguration, {
      credential: 'remove-me',
    })

    await expect(service.remove(created.id)).resolves.toBe(true)
    expect(credentials.entries.size).toBe(0)
    expect(() => providers.resolve(created.id)).toThrow()
    await expect(service.remove(created.id)).resolves.toBe(false)
  })

  it('normaliza diagnóstico, latência, compatibilidade e erros recentes', async () => {
    const { factory, service } = setup()
    const created = await service.create(remoteConfiguration, { credential: 'diagnostic-secret' })
    factory.availability = { status: 'degraded', message: 'Catálogo parcialmente indisponível.' }

    const first = await service.diagnose(created.id)
    const second = await service.diagnose(created.id)

    expect(first).toMatchObject({
      providerId: created.id,
      definition: {
        protocol: 'test',
        capabilities: { modelDiscovery: true, embeddings: false, streaming: true, cancellation: true, authentication: 'required' },
      },
      availability: { status: 'degraded', message: 'Catálogo parcialmente indisponível.' },
      connectivity: 'connected',
      authentication: 'configured',
      compatibility: 'compatible',
      latencyMs: expect.any(Number),
      recentErrors: [{ message: 'Catálogo parcialmente indisponível.' }],
    })
    expect(second.recentErrors).toHaveLength(2)
    expect(second.checkedAt).toBeTruthy()
  })

  it('reconstrói adapters e remove credenciais órfãs na inicialização', async () => {
    const { configurations, credentials, providers, service } = setup()
    const activeReference = ids[1]
    const configuration = configurations.create({
      ...remoteConfiguration,
      enabled: false,
    }, activeReference)
    credentials.entries.set(activeReference, 'active')
    credentials.entries.set(ids[2], 'orphan')

    await expect(service.initialize()).resolves.toEqual({
      loaded: 1,
      rejected: [],
      prunedCredentials: 1,
    })
    expect(credentials.entries).toEqual(new Map([[activeReference, 'active']]))
    expect(providers.resolve(configuration.id).definition.displayName)
      .toBe('Remote Provider')
  })

  it('recusa configuração inválida antes de tocar em SQLite ou cofre', async () => {
    const { configurations, credentials, service } = setup()
    await expect(service.create({
      ...remoteConfiguration,
      baseUrl: 'http://metadata.invalid',
    }, { credential: 'do-not-store' })).rejects.toMatchObject({
      code: 'invalid-configuration',
    })
    expect(configurations.list()).toEqual([])
    expect(credentials.entries.size).toBe(0)
  })
})

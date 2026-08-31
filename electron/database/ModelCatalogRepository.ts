import type Database from 'better-sqlite3'
import { z } from 'zod'
import type { ModelDescriptor } from '../../shared/ai/model'
import { MODEL_LIMITS } from '../../shared/ai/model'
import { modelDescriptorSchema } from '../../shared/ai/modelSchemas'
import type { DatabaseTransactionRunner } from './DatabaseTransaction'

const providerIdSchema = z.string().trim().min(1)
  .max(MODEL_LIMITS.identifierCharacters)

interface ModelCatalogRow {
  providerId: string
  modelId: string
  descriptor: string
}

export class ModelCatalogRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly transactions: DatabaseTransactionRunner,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(providerId?: string): ModelDescriptor[] {
    const rows = providerId === undefined
      ? this.database.prepare(`${modelCatalogSelect}
        ORDER BY provider_id, model_id`).all()
      : this.database.prepare(`${modelCatalogSelect}
        WHERE provider_id=? ORDER BY model_id`).all(
        providerIdSchema.parse(providerId),
      )
    return (rows as ModelCatalogRow[]).map(parseRow)
  }

  replaceProviderModels(
    providerId: string,
    inputs: readonly unknown[],
  ): ModelDescriptor[] {
    const validatedProviderId = providerIdSchema.parse(providerId)
    const descriptors = inputs.map((input) => modelDescriptorSchema.parse(input))
    const keys = new Set<string>()
    for (const descriptor of descriptors) {
      if (descriptor.providerId !== validatedProviderId) {
        throw new Error('O catálogo contém um modelo de outro Provider.')
      }
      if (keys.has(descriptor.modelId)) {
        throw new Error('O catálogo contém modelos duplicados.')
      }
      keys.add(descriptor.modelId)
    }

    this.transactions.run('modelCatalog.replaceProviderModels', () => {
      this.database.prepare('DELETE FROM model_catalog WHERE provider_id=?')
        .run(validatedProviderId)
      const insert = this.database.prepare(`INSERT INTO model_catalog(
        provider_id,model_id,descriptor,updated_at
      ) VALUES(?,?,?,?)`)
      const updatedAt = this.now().toISOString()
      for (const descriptor of descriptors) {
        insert.run(
          descriptor.providerId,
          descriptor.modelId,
          JSON.stringify(descriptor),
          updatedAt,
        )
      }
    })
    return descriptors.map(cloneDescriptor)
  }

  deleteProviderModels(providerId: string): number {
    return this.database.prepare('DELETE FROM model_catalog WHERE provider_id=?')
      .run(providerIdSchema.parse(providerId)).changes
  }
}

function parseRow(row: ModelCatalogRow): ModelDescriptor {
  try {
    const descriptor = modelDescriptorSchema.parse(JSON.parse(row.descriptor))
    if (descriptor.providerId !== row.providerId || descriptor.modelId !== row.modelId) {
      throw new Error()
    }
    return descriptor
  } catch {
    throw new Error('O catálogo de modelos persistido está inválido.')
  }
}

function cloneDescriptor(descriptor: ModelDescriptor): ModelDescriptor {
  return {
    ...descriptor,
    capabilities: [...descriptor.capabilities],
    pricing: descriptor.pricing ? { ...descriptor.pricing } : undefined,
  }
}

const modelCatalogSelect = `SELECT
  provider_id providerId,model_id modelId,descriptor
  FROM model_catalog`

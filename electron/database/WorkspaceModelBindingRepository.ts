import type Database from 'better-sqlite3'
import { z } from 'zod'
import type { WorkspaceModelBindings } from '../../shared/ai/bindings'
import { workspaceModelBindingsSchema } from '../../shared/ai/bindingSchemas'

const workspaceIdSchema = z.string().trim().min(1).max(512)

interface WorkspaceModelBindingRow {
  workspaceId: string
  bindings: string
}

export class WorkspaceModelBindingRepository {
  constructor(
    private readonly database: Database.Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): WorkspaceModelBindings[] {
    const rows = this.database.prepare(`${workspaceModelBindingSelect}
      ORDER BY workspace_id`).all() as WorkspaceModelBindingRow[]
    return rows.map(parseRow)
  }

  get(workspaceId: string): WorkspaceModelBindings | null {
    const validatedWorkspaceId = workspaceIdSchema.parse(workspaceId)
    const row = this.database.prepare(`${workspaceModelBindingSelect}
      WHERE workspace_id=?`).get(validatedWorkspaceId) as
      | WorkspaceModelBindingRow
      | undefined
    return row ? parseRow(row) : null
  }

  set(input: unknown): WorkspaceModelBindings {
    const bindings = workspaceModelBindingsSchema.parse(input)
    this.database.prepare(`INSERT INTO workspace_model_bindings(
      workspace_id,bindings,updated_at
    ) VALUES(?,?,?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      bindings=excluded.bindings,updated_at=excluded.updated_at`)
      .run(
        bindings.workspaceId,
        JSON.stringify(bindings),
        this.now().toISOString(),
      )
    return cloneBindings(bindings)
  }

  delete(workspaceId: string): boolean {
    return this.database.prepare(
      'DELETE FROM workspace_model_bindings WHERE workspace_id=?',
    ).run(workspaceIdSchema.parse(workspaceId)).changes > 0
  }
}

function parseRow(row: WorkspaceModelBindingRow): WorkspaceModelBindings {
  try {
    const bindings = workspaceModelBindingsSchema.parse(JSON.parse(row.bindings))
    if (bindings.workspaceId !== row.workspaceId) throw new Error()
    return bindings
  } catch {
    throw new Error('Os bindings de modelos persistidos estão inválidos.')
  }
}

function cloneBindings(bindings: WorkspaceModelBindings): WorkspaceModelBindings {
  return {
    ...bindings,
    defaultBinding: bindings.defaultBinding
      ? { ...bindings.defaultBinding }
      : undefined,
    embeddingBinding: bindings.embeddingBinding
      ? { ...bindings.embeddingBinding }
      : undefined,
    ...(bindings.remoteEmbeddingAllowed === undefined ? {} : { remoteEmbeddingAllowed: bindings.remoteEmbeddingAllowed }),
  }
}

const workspaceModelBindingSelect = `SELECT
  workspace_id workspaceId,bindings
  FROM workspace_model_bindings`

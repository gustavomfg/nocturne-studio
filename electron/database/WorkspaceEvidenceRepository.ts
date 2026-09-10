import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { EvidenceKind, EvidenceReference, EvidenceVerification, KnownWorkspacePath, WorkspaceStateManifest } from '../../shared/workspaceEvidence'

type EvidenceInput = Pick<WorkspaceStateManifest, 'workspace' | 'kind' | 'sourceId'> & {
  executionId?: string | null; startedAt?: string; paths?: KnownWorkspacePath[]; references?: EvidenceReference[]
}

/** Immutable observations, never a claim that independent tools consumed an atomic snapshot. */
export class WorkspaceEvidenceRepository {
  constructor(private readonly database: Database.Database) {}

  record(input: EvidenceInput): WorkspaceStateManifest {
    const existing = this.bySource(input.kind, input.sourceId)
    if (existing) {
      if (existing.workspace !== input.workspace || existing.executionId !== (input.executionId ?? null)) throw new Error('Identidade de evidência já pertence a outro workspace ou execução.')
      return existing
    }
    const now = new Date().toISOString()
    const paths = (input.paths ?? []).slice(0, 2_000)
    const manifest: WorkspaceStateManifest = {
      id: randomUUID(), workspace: input.workspace, executionId: input.executionId ?? null,
      kind: input.kind, sourceId: input.sourceId, startedAt: input.startedAt ?? now, observedAt: now,
      consistency: 'non-atomic', coverage: 'known-paths-only', validity: 'unknown', staleDetectedAt: null,
      reason: null, truncated: (input.paths?.length ?? 0) > paths.length || (input.references?.length ?? 0) > 500,
      paths, references: (input.references ?? []).slice(0, 500),
    }
    this.database.prepare(`INSERT INTO workspace_evidence(id,workspace,execution_id,kind,source_id,manifest_json)
      VALUES(?,?,?,?,?,?)`).run(manifest.id, manifest.workspace, manifest.executionId, manifest.kind, manifest.sourceId, JSON.stringify(manifest))
    return manifest
  }

  bySource(kind: EvidenceKind, sourceId: string): WorkspaceStateManifest | null {
    const row = this.database.prepare('SELECT manifest_json value FROM workspace_evidence WHERE kind=? AND source_id=?').get(kind, sourceId) as { value: string } | undefined
    return row ? this.current(JSON.parse(row.value) as WorkspaceStateManifest) : null
  }

  list(workspace: string, executionId?: string): WorkspaceStateManifest[] {
    const rows = this.database.prepare(`SELECT manifest_json value FROM workspace_evidence
      WHERE workspace=? AND (? IS NULL OR execution_id=?) ORDER BY rowid DESC LIMIT 20`).all(workspace, executionId ?? null, executionId ?? null) as Array<{ value: string }>
    const records = rows.map((row) => JSON.parse(row.value) as WorkspaceStateManifest)
    if (executionId) {
      const engineering = this.database.prepare(`SELECT manifest_json value FROM workspace_evidence e WHERE workspace=? AND kind='engineering'
        AND EXISTS (SELECT 1 FROM json_each(e.manifest_json,'$.references') r WHERE json_extract(r.value,'$.kind')='execution' AND json_extract(r.value,'$.id')=?)
        ORDER BY rowid DESC LIMIT 1`).get(workspace, executionId) as { value: string } | undefined
      if (engineering && records.length < 20) records.push(JSON.parse(engineering.value) as WorkspaceStateManifest)
      for (const record of records) {
        for (const reference of record.references) {
          if (records.length >= 20) break
          const parent = this.reference(workspace, reference)
          if (parent && !records.some((item) => item.id === parent.id)) records.push(parent)
        }
      }
    }
    return records.map((record) => this.current(record))
  }

  invalidate(workspace: string, reason: string) {
    // A workspace event invalidates the claim of currency, not historical evidence.
    // Conservative workspace-wide invalidation also covers unknown/unindexed paths.
    this.database.prepare(`UPDATE workspace_evidence SET stale_detected_at=COALESCE(stale_detected_at,?),stale_reason=COALESCE(stale_reason,?)
      WHERE workspace=? AND stale_detected_at IS NULL`).run(new Date().toISOString(), reason, workspace)
  }

  current(manifest: WorkspaceStateManifest, visited = new Set<string>()): WorkspaceStateManifest {
    if (visited.has(manifest.id) || visited.size >= 100) return manifest
    visited.add(manifest.id)
    const row = this.database.prepare('SELECT stale_detected_at staleDetectedAt,stale_reason reason,verification_json verification FROM workspace_evidence WHERE id=?').get(manifest.id) as { staleDetectedAt: string | null; reason: string | null; verification: string | null } | undefined
    const current = { ...manifest, ...(row?.verification ? { verification: JSON.parse(row.verification) as EvidenceVerification } : {}) }
    if (row?.staleDetectedAt) return { ...current, validity: 'stale', staleDetectedAt: row.staleDetectedAt, reason: row.reason }
    for (const reference of manifest.references) {
      const parent = this.reference(manifest.workspace, reference)
      if (parent && this.current(parent, visited).validity === 'stale') {
        this.markStale(manifest.id, `Evidência referenciada está stale: ${parent.id}`)
        return this.current(manifest)
      }
    }
    return current
  }

  markStale(id: string, reason: string) {
    this.database.prepare('UPDATE workspace_evidence SET stale_detected_at=COALESCE(stale_detected_at,?),stale_reason=COALESCE(stale_reason,?) WHERE id=?').run(new Date().toISOString(), reason, id)
  }

  saveVerification(id: string, verification: EvidenceVerification) {
    this.database.prepare('UPDATE workspace_evidence SET verification_json=? WHERE id=?').run(JSON.stringify(verification), id)
  }

  private reference(workspace: string, reference: EvidenceReference): WorkspaceStateManifest | null {
    const row = this.database.prepare(`SELECT manifest_json value FROM workspace_evidence WHERE workspace=? AND
      ((?='manifest' AND id=?) OR (kind=? AND source_id=?))`).get(workspace, reference.kind, reference.id, reference.kind, reference.id) as { value: string } | undefined
    return row ? JSON.parse(row.value) as WorkspaceStateManifest : null
  }

  knownProjectPaths(workspace: string): KnownWorkspacePath[] {
    return this.database.prepare('SELECT relative_path path,analyzed_hash hash FROM project_index_files WHERE workspace=? AND excluded=0 ORDER BY relative_path LIMIT 2001').all(workspace) as KnownWorkspacePath[]
  }

  recordIndex(kind: 'project-index' | 'semantic-index', workspace: string, sourceId: string, startedAt: string) {
    const paths = kind === 'project-index' ? this.knownProjectPaths(workspace) : this.database.prepare('SELECT DISTINCT relative_path path,source_hash hash FROM semantic_units WHERE workspace=? ORDER BY relative_path LIMIT 2001').all(workspace) as KnownWorkspacePath[]
    return this.record({ kind, workspace, sourceId, startedAt, paths })
  }

  indexReferences(workspace: string): EvidenceReference[] {
    return (['project-index', 'semantic-index'] as const).flatMap((kind) => {
      const row = this.database.prepare('SELECT id FROM workspace_evidence WHERE workspace=? AND kind=? ORDER BY rowid DESC LIMIT 1').get(workspace, kind) as { id: string } | undefined
      return row ? [{ kind: 'manifest', id: row.id }] : []
    })
  }

  checkpointReferences(executionId?: string): EvidenceReference[] {
    if (!executionId) return []
    return this.database.prepare("SELECT phase kind,id FROM checkpoints WHERE execution_id=? AND status='ready' ORDER BY captured_at LIMIT 20").all(executionId) as EvidenceReference[]
  }
}

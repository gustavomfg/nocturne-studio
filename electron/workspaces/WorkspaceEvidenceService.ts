import { createHash } from 'node:crypto'
import path from 'node:path'
import type { WorkspaceStateManifest } from '../../shared/workspaceEvidence'
import type { WorkspaceEvidenceRepository } from '../database/WorkspaceEvidenceRepository'
import { readWorkspaceFile } from '../security/ExecutionPolicy'

/** Bounded verification of known content; matching samples never prove global currency. */
export async function checkWorkspaceEvidence(repository: WorkspaceEvidenceRepository, manifest: WorkspaceStateManifest) {
  let matchedPaths = 0
  let mismatchedPaths = 0
  for (const entry of manifest.paths.slice(0, 200)) {
    if (!entry.hash && entry.exists !== false) continue
    try {
      const file = await readWorkspaceFile(path.resolve(manifest.workspace, entry.path), manifest.workspace, 2 * 1024 * 1024)
      if (entry.exists !== false && createHash('sha256').update(file.content).digest('hex') === entry.hash) { matchedPaths += 1; continue }
      mismatchedPaths += 1
      repository.markStale(manifest.id, `Hash divergente observado: ${entry.path}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        if (entry.exists === false) matchedPaths += 1
        else {
          mismatchedPaths += 1
          repository.markStale(manifest.id, `Caminho ausente observado: ${entry.path}`)
        }
      }
      // Inaccessible/oversized files remain unknown, never valid by omission.
    }
  }
  repository.saveVerification(manifest.id, { checkedAt: new Date().toISOString(), matchedPaths, mismatchedPaths, uncheckedPaths: manifest.paths.length - matchedPaths - mismatchedPaths })
  return repository.current(manifest)
}

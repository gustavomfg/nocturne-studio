import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { LocalDatabase } from '../electron/database/Database'
import { CheckpointService } from '../electron/change-control/CheckpointService'
import { WorkspaceCheckpointStore } from '../electron/change-control/WorkspaceCheckpointStore'
import { checkWorkspaceEvidence } from '../electron/workspaces/WorkspaceEvidenceService'
import { ProjectIndexService } from '../electron/project-index/ProjectIndexService'
import { SemanticIndexService } from '../electron/semantic-index/SemanticIndexService'
import { ChangeCaptureService } from '../electron/change-control/ChangeCaptureService'
import { ChangeDecisionService } from '../electron/change-control/ChangeDecisionService'
import { SnapshotRollbackService } from '../electron/change-control/SnapshotRollbackService'
import { ValidationPipeline } from '../electron/validation/ValidationPipeline'
import { EngineeringSignalEngine } from '../electron/engineering/EngineeringSignalEngine'
import Database from 'better-sqlite3'

it('does not present a sequential checkpoint as a current atomic workspace snapshot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-evidence-'))
  const workspace = path.join(root, 'project'); fs.mkdirSync(workspace)
  const db = new LocalDatabase(root)
  try {
    const conversation = db.createConversation(workspace)
    db.createExecution({ id: 'execution', workspace, conversationId: conversation.id, prompt: 'test', mode: 'build', status: 'running', decision: 'pending', retryOf: null, startedAt: new Date().toISOString(), finishedAt: null, error: null })
    const target = path.join(workspace, 'file.txt'); fs.writeFileSync(target, 'observed')
    const store = new WorkspaceCheckpointStore(path.join(root, 'snapshots'))
    const original = store.capture.bind(store)
    vi.spyOn(store, 'capture').mockImplementation(async (...args) => {
      const files = await original(...args)
      fs.writeFileSync(target, 'changed-before-capture-completed')
      return files
    })
    const result = await new CheckpointService(db.checkpoints, store).capture('execution', workspace, 'before')
    expect(result.checkpoint.status).toBe('ready')
    expect(result).toHaveProperty('evidence.consistency', 'non-atomic')
    const checked = await checkWorkspaceEvidence(db.workspaceEvidence, result.evidence)
    expect(checked).toMatchObject({ validity: 'stale', verification: { matchedPaths: 0, mismatchedPaths: 1, uncheckedPaths: 0 } })
    expect(checked.staleDetectedAt).not.toBeNull()
    const stored = db.workspaceEvidence.bySource('before', result.checkpoint.id)!
    expect(stored.paths).toEqual([{ path: 'file.txt', hash: result.files[0].hash, exists: true }])
    expect(stored.validity).toBe('stale')
    const missing = await new CheckpointService(db.checkpoints, store).capture('execution', workspace, 'after', ['new.txt'])
    expect((await checkWorkspaceEvidence(db.workspaceEvidence, missing.evidence)).verification?.matchedPaths).toBe(1)
    fs.writeFileSync(path.join(workspace, 'new.txt'), 'new user file')
    expect((await checkWorkspaceEvidence(db.workspaceEvidence, missing.evidence)).validity).toBe('stale')
  } finally { vi.restoreAllMocks(); db.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

it('links real indexes, checkpoints, validation, decision and engineering without rewriting observed hashes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-evidence-flow-'))
  const workspace = path.join(root, 'project'); fs.mkdirSync(workspace)
  let db = new LocalDatabase(root)
  const project = new ProjectIndexService(db.projectIndex)
  const semantic = new SemanticIndexService(db.semanticIndex, { projectIndex: project })
  const validation = new ValidationPipeline(db.validation, (value) => project.listStackEvidence(value), { runner: { run: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 1, cancelled: false, timedOut: false, truncated: false, error: null, terminationUncertain: false, terminationScope: null }) } })
  const engineering = new EngineeringSignalEngine(db.engineeringIntelligence, project, validation, { semanticIndex: semantic, executionIds: () => ['execution'] })
  try {
    const conversation = db.createConversation(workspace)
    db.createExecution({ id: 'execution', workspace, conversationId: conversation.id, prompt: 'test', mode: 'build', status: 'completed', decision: 'pending', retryOf: null, startedAt: new Date().toISOString(), finishedAt: null, error: null })
    fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }))
    const target = path.join(workspace, 'file.ts'); fs.writeFileSync(target, 'export const value = 1')
    await project.ensureIndexed(workspace)
    await semantic.ensureIndexed(workspace)
    const indexManifest = db.workspaceEvidence.bySource('project-index', project.getSummary(workspace).latestRun!.id)!
    const context = db.workspaceEvidence.record({ workspace, executionId: 'execution', kind: 'context', sourceId: 'execution', references: [{ kind: 'manifest', id: indexManifest.id }] })
    const checkpoints = new CheckpointService(db.checkpoints, new WorkspaceCheckpointStore(path.join(root, 'snapshots')))
    const before = await checkpoints.capture('execution', workspace, 'before')
    fs.writeFileSync(target, 'export const value = 2')
    db.workspaceEvidence.invalidate(workspace, 'deterministic filesystem notification')
    const after = await new ChangeCaptureService(checkpoints, db.changeSets).capture('execution', workspace, before.checkpoint.id, 'manual')
    const run = await validation.run(workspace, 'test', 'execution')
    expect(run.status).toBe('passed')
    const validationEvidence = db.workspaceEvidence.bySource('validation', run.id)!
    expect(validationEvidence.references).toContainEqual({ kind: 'after', id: after.changeSet.afterCheckpointId })
    // Successful tooling does not turn stale input provenance into current evidence.
    expect(validationEvidence.validity).toBe('stale')
    await new ChangeDecisionService(db.changeSets, new SnapshotRollbackService(checkpoints)).decide('execution', after.changes[0].id, 'accepted', workspace)
    const health = await engineering.evaluate(workspace)
    expect(db.workspaceEvidence.bySource('engineering', health.snapshot.id)?.references).toContainEqual({ kind: 'validation', id: run.id })
    const records = db.workspaceEvidence.list(workspace, 'execution')
    expect(new Set(records.map((item) => item.kind))).toEqual(new Set(['context', 'project-index', 'semantic-index', 'before', 'after', 'validation', 'decision', 'engineering']))
    expect(db.workspaceEvidence.current(context).validity).toBe('stale')
    expect(db.workspaceEvidence.bySource('project-index', indexManifest.sourceId)?.paths).toEqual(indexManifest.paths)
    expect(() => db.workspaceEvidence.record({ workspace: '/other', kind: 'context', sourceId: 'execution' })).toThrow(/outro workspace/)
    await engineering.dispose(); await validation.dispose(); await semantic.dispose(); await project.dispose()
    db.close(); db = new LocalDatabase(root)
    expect(db.workspaceEvidence.list(workspace, 'execution')).toEqual(records)
  } finally {
    await engineering.dispose(); await validation.dispose(); await semantic.dispose(); await project.dispose()
    db.close(); fs.rmSync(root, { recursive: true, force: true })
  }
})

it('migrates schema 29 without fabricating evidence for legacy checkpoints', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-evidence-migration-'))
  const workspace = path.join(root, 'project'); fs.mkdirSync(workspace)
  let db = new LocalDatabase(root)
  try {
    const conversation = db.createConversation(workspace)
    db.createExecution({ id: 'legacy', workspace, conversationId: conversation.id, prompt: 'preserved', mode: 'build', status: 'completed', decision: 'pending', retryOf: null, startedAt: new Date().toISOString(), finishedAt: null, error: null })
    fs.writeFileSync(path.join(workspace, 'file.txt'), 'preserved')
    const checkpoints = new CheckpointService(db.checkpoints, new WorkspaceCheckpointStore(path.join(root, 'snapshots')))
    const before = await checkpoints.capture('legacy', workspace, 'before')
    const persistedFiles = db.checkpoints.listFiles(before.checkpoint.id)
    db.close()
    const legacy = new Database(path.join(root, 'nocturne.db'))
    legacy.exec('DROP TABLE workspace_evidence')
    legacy.pragma('user_version = 29')
    legacy.close()
    db = new LocalDatabase(root)
    expect(db.getExecution('legacy')?.prompt).toBe('preserved')
    expect(db.checkpoints.listFiles(before.checkpoint.id)).toEqual(persistedFiles)
    expect(db.workspaceEvidence.list(workspace, 'legacy')).toEqual([])
    expect(db.workspaceEvidence.record({ workspace, executionId: 'legacy', kind: 'context', sourceId: 'new-observation' }).validity).toBe('unknown')
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }) }
})

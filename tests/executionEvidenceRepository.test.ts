import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalDatabase } from '../electron/database/Database'
import type { ExecutionCommandRecord, ExecutionErrorRecord } from '../shared/changeControl'

const directories: string[] = []
const databases: LocalDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('ExecutionEvidenceRepository', () => {
  it('persiste comandos, erros e vínculos de validação de forma limitada', () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-evidence-db-'))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-evidence-project-'))
    directories.push(userData, workspace)
    const database = new LocalDatabase(userData)
    databases.push(database)
    const conversation = database.createConversation(workspace)
    const executionId = '00000000-0000-4000-8000-000000000050'
    database.createExecution({ id: executionId, workspace, conversationId: conversation.id, prompt: 'evidence', mode: 'build', status: 'running', decision: 'pending', retryOf: null, startedAt: new Date().toISOString(), finishedAt: null, error: null })
    const command: ExecutionCommandRecord = {
      id: '00000000-0000-4000-8000-000000000051', executionId, command: 'npm', args: ['test'], source: 'validation', status: 'passed', exitCode: 0, durationMs: 120, outputSummary: 'ok', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    }
    database.executionEvidence.saveCommand(command)
    const error: ExecutionErrorRecord = {
      id: '00000000-0000-4000-8000-000000000052', executionId, stage: 'validation', message: 'falhou', path: 'src/App.tsx', createdAt: new Date().toISOString(),
    }
    database.executionEvidence.createError(error)
    const validation = database.validation
    const run = { id: '00000000-0000-4000-8000-000000000053', workspace, executionId, kind: 'test' as const, command: 'npm', args: ['test'], status: 'passed' as const, exitCode: 0, durationMs: 12, outputSummary: 'ok', artifacts: [], startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), error: null }
    validation.create(run)
    database.executionEvidence.linkValidation({ executionId, changeId: null, validationId: run.id, phase: 'proposed' })
    database.executionEvidence.linkValidation({ executionId, changeId: null, validationId: run.id, phase: 'proposed' })

    expect(database.executionEvidence.listCommands(executionId)).toEqual([command])
    expect(database.executionEvidence.listErrors(executionId)).toEqual([error])
    expect(database.executionEvidence.listValidationLinks(executionId)).toEqual([{ executionId, changeId: null, validationId: run.id, phase: 'proposed' }])
    expect(database.getExecution(executionId)?.validationCount).toBe(1)
  })
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalDatabase } from '../electron/database/Database'
import type { ExecutionRecord } from '../shared/changeControl'

const directories: string[] = []
const databases: LocalDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('ExecutionRepository', () => {
  it('persiste, atualiza e lista uma execução por workspace e conversa', () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-execution-db-'))
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-execution-project-'))
    directories.push(userData, workspace)
    const database = new LocalDatabase(userData)
    databases.push(database)
    const conversation = database.createConversation(workspace)
    const record: ExecutionRecord = {
      id: '00000000-0000-4000-8000-000000000001',
      workspace,
      conversationId: conversation.id,
      prompt: 'Corrigir o módulo',
      mode: 'build',
      status: 'running',
      decision: 'pending',
      retryOf: null,
      startedAt: '2026-09-03T12:00:00.000Z',
      finishedAt: null,
      error: null,
    }

    database.saveExecution(record)
    expect(database.getExecution(record.id, workspace)).toMatchObject({ id: record.id, status: 'running', decision: 'pending', changeCount: 0 })

    database.saveExecution({ ...record, status: 'completed', decision: 'accepted', finishedAt: '2026-09-03T12:01:00.000Z' })
    expect(database.listExecutions(workspace, conversation.id)).toMatchObject([{ status: 'completed', decision: 'accepted' }])
  })
})

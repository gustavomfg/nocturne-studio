import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WORKSPACE_READ_LIMITS } from '../shared/constants'
import { appendSuggestionDecision } from '../electron/persistence/SuggestionDecisionLog'
import { expectUserOnlyMode, removeTestDirectory } from './helpers/platform'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) removeTestDirectory(directory) })

describe('SuggestionDecisionLog', () => {
  it('serializa decisões concorrentes em uma única seção e preserva permissões restritas', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-decisions-')); directories.push(directory)
    const memoryPath = path.join(directory, 'memory.md')
    fs.writeFileSync(memoryPath, '# Memória\n', { mode: 0o600 })
    await Promise.all([
      appendSuggestionDecision(directory, memoryPath, { title: 'Primeira', status: 'accepted', updatedAt: '2026-07-29T10:00:00.000Z' }),
      appendSuggestionDecision(directory, memoryPath, { title: 'Segunda', status: 'rejected', updatedAt: '2026-07-29T10:00:01.000Z' }),
    ])
    const content = fs.readFileSync(memoryPath, 'utf8')
    expect(content.match(/nocturne:suggestion-history/g)).toHaveLength(1)
    expect(content).toContain('"title":"Primeira"')
    expect(content).toContain('"title":"Segunda"')
    expectUserOnlyMode(fs.statSync(memoryPath).mode)
  })

  it('rejeita histórico acima do limite sem materializar o arquivo inteiro', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-decisions-large-')); directories.push(directory)
    const memoryPath = path.join(directory, 'memory.md')
    fs.writeFileSync(memoryPath, Buffer.alloc(WORKSPACE_READ_LIMITS.suggestionHistoryBytes + 1, 0x6d), { mode: 0o600 })
    await expect(appendSuggestionDecision(directory, memoryPath, { title: 'Grande', status: 'accepted', updatedAt: '2026-07-29T10:00:00.000Z' })).rejects.toThrow(/histórico de sugestões excede/)
  })
})

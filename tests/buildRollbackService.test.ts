import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BuildRollbackService } from '../electron/ai/BuildRollbackService'
import { removeTestDirectory } from './helpers/platform'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    removeTestDirectory(directory)
  }
})

function repository() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-build-rollback-'))
  directories.push(directory)
  execFileSync('git', ['init'], { cwd: directory })
  execFileSync('git', ['config', 'user.name', 'Nocturne Test'], { cwd: directory })
  execFileSync('git', ['config', 'user.email', 'nocturne@example.invalid'], { cwd: directory })
  fs.writeFileSync(path.join(directory, 'tracked.txt'), 'antes\n')
  execFileSync('git', ['add', 'tracked.txt'], { cwd: directory })
  execFileSync('git', ['commit', '-m', 'test: baseline'], { cwd: directory })
  return directory
}

describe('BuildRollbackService', () => {
  it('restaura somente caminhos reportados de um workspace inicialmente limpo', async () => {
    const workspace = repository()
    const service = new BuildRollbackService()
    await expect(service.begin('conversation-1', workspace)).resolves.toMatchObject({
      available: true,
      files: [],
    })

    fs.writeFileSync(path.join(workspace, 'tracked.txt'), 'depois\n')
    fs.writeFileSync(path.join(workspace, 'created.txt'), 'novo\n')
    service.complete('conversation-1', ['tracked.txt', 'created.txt'])

    await expect(service.rollback('conversation-1', workspace)).resolves.toEqual({
      restored: ['tracked.txt', 'created.txt'],
    })
    expect(fs.readFileSync(path.join(workspace, 'tracked.txt'), 'utf8')).toBe('antes\n')
    expect(fs.existsSync(path.join(workspace, 'created.txt'))).toBe(false)
    expect(service.status('conversation-1').available).toBe(false)
  })

  it('não oferece rollback quando já havia alterações do usuário', async () => {
    const workspace = repository()
    fs.writeFileSync(path.join(workspace, 'tracked.txt'), 'alteração do usuário\n')
    const service = new BuildRollbackService()
    const status = await service.begin('conversation-1', workspace)
    expect(status).toMatchObject({
      available: false,
      reason: expect.stringContaining('já possuía alterações'),
    })
    service.complete('conversation-1', ['tracked.txt'])
    await expect(service.rollback('conversation-1', workspace)).rejects.toThrow(/já possuía alterações/)
    expect(fs.readFileSync(path.join(workspace, 'tracked.txt'), 'utf8')).toBe('alteração do usuário\n')
  })

  it('recusa caminhos externos reportados pela execução', async () => {
    const workspace = repository()
    const service = new BuildRollbackService()
    await service.begin('conversation-1', workspace)
    service.complete('conversation-1', ['../outside.txt'])
    expect(service.status('conversation-1')).toMatchObject({
      available: false,
      reason: expect.stringContaining('fora do workspace'),
    })
  })
})

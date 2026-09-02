import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalDatabase } from '../electron/database/Database'
import { ValidationPipeline, planValidation } from '../electron/validation/ValidationPipeline'
import type { ProcessRunner, ProcessRunResult } from '../electron/validation/CancellableProcessRunner'
import type { StackEvidence } from '../shared/codeIntelligence'

const directories: string[] = []
const databases: LocalDatabase[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('Validation Pipeline', () => {
  it('planeja pelo stack, persiste o resultado e mantém artefatos dentro do workspace', async () => {
    const fixture = createFixture()
    fs.mkdirSync(path.join(fixture.workspace, 'reports'), { recursive: true })
    fs.writeFileSync(path.join(fixture.workspace, 'reports', 'test.html'), '<html/>')
    fixture.database.projectIndex.replaceStackEvidence(fixture.workspace, [
      evidence(fixture.workspace, 'package-manager', 'npm'),
      evidence(fixture.workspace, 'script', 'test=vitest'),
    ])
    const calls: string[][] = []
    const runner: ProcessRunner = { run: async (command, args) => {
      calls.push([command, ...args])
      return successfulResult('api_key=do-not-persist\nreports/test.html\n', '')
    } }
    const pipeline = new ValidationPipeline(fixture.database.validation, (workspace) => fixture.database.projectIndex.listStackEvidence(workspace), { runner })

    const run = await pipeline.run(fixture.workspace, 'test')

    expect(calls).toEqual([['npm', 'run', 'test']])
    expect(run).toMatchObject({ status: 'passed', exitCode: 0, kind: 'test' })
    expect(run.outputSummary).toContain('reports/test.html')
    expect(run.outputSummary).not.toContain('do-not-persist')
    expect(run.artifacts).toEqual([{ path: 'reports/test.html', kind: 'html', size: 7 }])
    expect(pipeline.latest(fixture.workspace)?.id).toBe(run.id)
  })

  it('bloqueia validação sem comando identificado e mantém resultado estruturado', async () => {
    const fixture = createFixture()
    const pipeline = new ValidationPipeline(fixture.database.validation, () => [], { runner: throwingRunner() })

    const run = await pipeline.run(fixture.workspace, 'lint')

    expect(run).toMatchObject({ status: 'blocked', exitCode: null, durationMs: expect.any(Number) })
    expect(run.error).toMatch(/Nenhum comando/)
    expect(fixture.database.validation.list(fixture.workspace)).toHaveLength(1)
  })

  it('cancela o processo ativo sem perder o registro da execução', async () => {
    const fixture = createFixture()
    fixture.database.projectIndex.replaceStackEvidence(fixture.workspace, [evidence(fixture.workspace, 'script', 'test=vitest')])
    const runner: ProcessRunner = { run: async (_command, _args, options) => new Promise<ProcessRunResult>((resolve) => {
      options.signal.addEventListener('abort', () => resolve({ ...successfulResult('', ''), cancelled: true }), { once: true })
    }) }
    const pipeline = new ValidationPipeline(fixture.database.validation, (workspace) => fixture.database.projectIndex.listStackEvidence(workspace), { runner })
    const pending = pipeline.run(fixture.workspace, 'test')
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(pipeline.cancel(fixture.workspace)).toBe(true)

    await expect(pending).resolves.toMatchObject({ status: 'cancelled' })
    expect(pipeline.cancel(fixture.workspace)).toBe(false)
  })

  it('faz fallback para TypeScript sem transformar texto em comando shell', () => {
    const stack = [evidence('/workspace', 'language', 'TypeScript'), evidence('/workspace', 'package-manager', 'pnpm')]
    expect(planValidation(stack, 'typecheck')).toEqual(expect.objectContaining({ command: 'pnpm', args: ['exec', 'tsc', '--noEmit'] }))
    expect(planValidation(stack, 'smoke')).toBeNull()
  })
})

function createFixture() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-validation-db-'))
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-validation-project-'))
  directories.push(userData, workspace)
  const database = new LocalDatabase(userData)
  databases.push(database)
  database.touchWorkspace(workspace)
  return { workspace, database }
}

function evidence(workspace: string, category: StackEvidence['category'], value: string): StackEvidence {
  return { id: `${category}-${value}`, workspace, category, value, confidence: 90, sourcePath: 'package.json', sourceHash: 'a'.repeat(64), sourceLine: null, reason: 'Teste', detectedAt: new Date().toISOString() }
}

function successfulResult(stdout: string, stderr: string): ProcessRunResult {
  return { exitCode: 0, stdout, stderr, durationMs: 5, cancelled: false, timedOut: false, truncated: false, error: null }
}

function throwingRunner(): ProcessRunner {
  return { run: async () => { throw new Error('runner não deveria ser chamado') } }
}

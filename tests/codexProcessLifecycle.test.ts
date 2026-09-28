import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { expect, it, vi } from 'vitest'
import { CodexProcess } from '../electron/codex/CodexProcess'
import { canonicalTestPath, removeTestDirectory } from './helpers/platform'

function alive(pid: number) {
  if (process.platform === 'linux') {
    try { return !['Z', 'X'].includes(fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[2]) } catch { return false }
  }
  try { process.kill(pid, 0); return true } catch { return false }
}

it.runIf(process.platform !== 'win32').each(['natural', 'term'])('Codex transport bounds cleanup after %s parent exit with resistant descendants (real processes, not authenticated Codex)', async (exitMode) => {
  const base = canonicalTestPath(fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-codex-lifecycle-')))
  const marker = path.join(base, 'ready.pid')
  const script = path.join(base, 'fixture.cjs')
  let descendant = 0
  let owned: childProcess.ChildProcess | undefined
  const launch = childProcess.spawn
  const observation = vi.spyOn(childProcess, 'spawn').mockImplementation((...args: Parameters<typeof launch>) => { owned = launch(...args); return owned })
  syncBuiltinESMExports()
  const transport = new CodexProcess()
  const terminations: Array<{ terminationUncertain: boolean }> = []
  transport.on('termination', (result) => terminations.push(result))
  const errors: Error[] = []
  transport.on('error', (error) => errors.push(error))
  const exited = new Promise<void>((resolve) => transport.once('exit', () => resolve()))
  try {
    const childSource = `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); process.send('READY'); setInterval(() => {}, 1000)`
    fs.writeFileSync(script, `#!/usr/bin/env node\nconst child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childSource)}], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      if (${JSON.stringify(exitMode)} === 'natural') child.once('message', () => process.exit(0));
      process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);\n`, { mode: 0o700 })
    transport.start(script)
    await vi.waitFor(() => {
      if (fs.existsSync(marker)) descendant = Number(fs.readFileSync(marker, 'utf8'))
      expect(descendant).toBeGreaterThan(0)
    })
    if (exitMode === 'natural') await exited
    const start = Date.now()
    await transport.stop()
    await exited
    expect(Date.now() - start).toBeLessThan(6_000)
    expect(errors).toEqual([])
    expect(owned?.stdout?.destroyed).toBe(true)
    expect(owned?.stderr?.destroyed).toBe(true)
    expect(terminations).toHaveLength(1)
    if (process.platform === 'linux') expect(alive(descendant)).toBe(false)
    if (!terminations[0].terminationUncertain) expect(alive(descendant)).toBe(false)
  } finally {
    await transport.stop()
    if (descendant && alive(descendant)) { try { process.kill(descendant, 'SIGKILL') } catch { /* already exited */ } }
    observation.mockRestore(); syncBuiltinESMExports()
    removeTestDirectory(base)
  }
}, 8_000)

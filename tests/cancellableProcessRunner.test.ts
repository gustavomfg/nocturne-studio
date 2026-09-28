import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { CancellableProcessRunner } from '../electron/validation/CancellableProcessRunner'

const linuxOnly = process.platform === 'linux' ? it : it.skip

async function waitForFile(filePath: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(filePath)) {
      const pid = Number(fs.readFileSync(filePath, 'utf8'))
      if (Number.isInteger(pid) && pid > 0) return pid
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('O descendente controlado não iniciou.')
}

function alive(pid: number) {
  try {
    const state = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(' ')[2]
    return state !== 'Z' && state !== 'X'
  } catch {
    return false
  }
}

describe('cancelamento de árvore de validação com processos reais', () => {
  linuxOnly('releases its pipes at the deadline even when an escaped descendant still holds them', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-process-escape-'))
    const marker = path.join(root, 'ready.pid')
    const controller = new AbortController()
    let descendant = 0
    let owned: childProcess.ChildProcess | undefined
    const spawn = childProcess.spawn
    // Observe the real child; no OS operation or result is mocked.
    const observation = vi.spyOn(childProcess, 'spawn').mockImplementation((...args: Parameters<typeof spawn>) => {
      owned = spawn(...args)
      return owned
    })
    syncBuiltinESMExports()
    try {
      const childSource = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 1000)`
      const parentSource = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childSource)}], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] }).unref()`
      const run = new CancellableProcessRunner().run('node', ['-e', parentSource], { cwd: root, signal: controller.signal, timeoutMs: 10_000 })
      descendant = await waitForFile(marker)
      controller.abort()
      const result = await run
      expect(result).toMatchObject({ cancelled: true, terminationUncertain: true })
      expect(alive(descendant)).toBe(true)
      expect(owned?.stdout?.destroyed).toBe(true)
      expect(owned?.stderr?.destroyed).toBe(true)
    } finally {
      observation.mockRestore()
      syncBuiltinESMExports()
      controller.abort()
      if (descendant && alive(descendant)) { try { process.kill(descendant, 'SIGKILL') } catch { /* already exited */ } }
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 8_000)

  linuxOnly.each(['ignore', 'inherit'] as const)('não presume fim da árvore quando o pai sai e o descendente mantém stdio %s', async (stdioMode) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-process-tree-'))
    const marker = path.join(root, 'child.pid')
    const controller = new AbortController()
    let descendant = 0
    try {
      const script = `
        const { spawn } = require('node:child_process');
        const child = spawn(process.execPath, ['-e', ${JSON.stringify(`process.on('SIGTERM', () => {}); require('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 1000)`)}], { stdio: ['ignore', '${stdioMode}', '${stdioMode}'] });
        process.on('SIGTERM', () => process.exit(0));
        setInterval(() => {}, 1000);
      `
      const started = Date.now()
      const run = new CancellableProcessRunner().run('node', ['-e', script], { cwd: root, signal: controller.signal, timeoutMs: 10_000 })
      descendant = await waitForFile(marker)
      controller.abort()
      const result = await run
      expect(Date.now() - started).toBeLessThan(6_000)
      expect(result.cancelled).toBe(true)
      expect(result.terminationScope).toBe('process-group')
      if (!result.terminationUncertain) expect(alive(descendant)).toBe(false)
    } finally {
      controller.abort()
      if (descendant && alive(descendant)) {
        try { process.kill(descendant, 'SIGKILL') } catch { /* already exited */ }
      }
      fs.rmSync(root, { recursive: true, force: true })
    }
  }, 8_000)
})

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CancellableProcessRunner } from '../electron/validation/CancellableProcessRunner'

const linuxOnly = process.platform === 'linux' ? it : it.skip

async function waitForFile(filePath: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fs.existsSync(filePath)) return Number(fs.readFileSync(filePath, 'utf8'))
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
  linuxOnly.each(['ignore', 'inherit'] as const)('não presume fim da árvore quando o pai sai e o descendente mantém stdio %s', async (stdioMode) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-process-tree-'))
    const marker = path.join(root, 'child.pid')
    const controller = new AbortController()
    let descendant = 0
    try {
      const script = `
        const fs = require('node:fs');
        const { spawn } = require('node:child_process');
        const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: ['ignore', '${stdioMode}', '${stdioMode}'] });
        fs.writeFileSync(${JSON.stringify(marker)}, String(child.pid));
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

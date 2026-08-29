import { dialog, type BrowserWindow } from 'electron'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { LocalDatabase } from '../database/Database'
import { gitCommitSchema, idSchema } from '../../shared/ipc/schemas'
import { resolveInsideWorkspace } from '../security/ExecutionPolicy'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'
import { getAuthorizedConversation } from './conversationAccess'
import { redactLogText } from '../logging/Logger'
import { IPC_CHANNELS } from '../../shared/ipc/channels'

const run = promisify(execFile)
const MAX_DIFF_CHARACTERS = 1_500_000
const MAX_GIT_FILES = 5_000
const GIT_OUTPUT_BUFFER = 8_000_000
const MAX_GIT_STATUS_CHARACTERS = 8_000_000

export function registerGitIpc(win: BrowserWindow, database: LocalDatabase, registrar?: SafeIpcMain) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar
  ipcMain.handle(IPC_CHANNELS.git.status, async (_event, value: unknown) => gitStatus(getWorkspace(database, idSchema.parse(value))))
  ipcMain.handle(IPC_CHANNELS.git.commit, async (_event, value: unknown) => {
    const data = gitCommitSchema.parse(value)
    const workspace = getWorkspace(database, data.conversationId)
    const current = await gitStatus(workspace)
    const files = resolveSelectedGitFiles(current.files, data.files).map((file) => {
      resolveInsideWorkspace(path.resolve(workspace, file), workspace)
      return file
    })
    const confirmation = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Cancelar', 'Preparar e criar commit'], defaultId: 0, cancelId: 0, title: 'Confirmar commit', message: `Criar commit no workspace ${path.basename(workspace)}?`, detail: `${files.length} arquivo(s) selecionado(s).\n\n${data.message}` })
    if (confirmation.response !== 1) throw new Error('Commit cancelado pelo usuário.')
    await run('git', ['add', '-A', '--', ...files], { cwd: workspace, timeout: 60_000, maxBuffer: GIT_OUTPUT_BUFFER })
    const { stdout } = await run('git', ['commit', '-m', data.message], { cwd: workspace, timeout: 60_000, maxBuffer: GIT_OUTPUT_BUFFER })
    return { output: stdout.trim() }
  })
  return () => { if (ownsRegistrar) ipcMain.dispose() }
}

export function resolveSelectedGitFiles(currentFiles: Array<{ path: string; originalPath?: string }>, requestedFiles: string[]) {
  if (!requestedFiles.length) throw new Error('Selecione ao menos um arquivo para criar o commit.')
  const currentByPath = new Map(currentFiles.map((file) => [file.path, file]))
  const missing = requestedFiles.filter((file) => !currentByPath.has(file))
  if (missing.length) throw new Error(`A seleção do Git ficou desatualizada. Atualize o painel e tente novamente: ${missing.join(', ')}`)
  const expanded = requestedFiles.flatMap((file) => {
    const current = currentByPath.get(file)!
    return [current.path, ...(current.originalPath ? [current.originalPath] : [])]
  })
  return [...new Set(expanded)]
}

function getWorkspace(database: LocalDatabase, id: string) {
  return getAuthorizedConversation(database, id).workspace
}

async function gitStatus(workspace: string) {
  const [branch, status, diff, staged] = await Promise.all([
    run('git', ['branch', '--show-current'], { cwd: workspace, timeout: 30_000, maxBuffer: 64_000 }), readGitOutput(workspace, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], MAX_GIT_STATUS_CHARACTERS),
    readDiff(workspace, ['diff', '--no-ext-diff']), readDiff(workspace, ['diff', '--cached', '--no-ext-diff']),
  ])
  const completeStatus = status.truncated ? status.stdout.slice(0, status.stdout.lastIndexOf('\0') + 1) : status.stdout
  const parsedFiles = parsePorcelainZ(completeStatus)
  const filesTruncated = status.truncated || parsedFiles.length > MAX_GIT_FILES
  const files = parsedFiles.slice(0, MAX_GIT_FILES)
  const fullDiff = [diff.stdout, staged.stdout].filter(Boolean).join('\n')
  const diffTruncated = diff.truncated || staged.truncated || fullDiff.length > MAX_DIFF_CHARACTERS
  const visibleDiff = diffTruncated ? `${fullDiff.slice(0, MAX_DIFF_CHARACTERS)}\n\n[Diff truncado pelo Nocturne para preservar a estabilidade. Abra o Git ou editor para inspecionar o restante.]` : fullDiff
  return { branch: branch.stdout.trim() || '(detached)', status: files.map((file) => `${file.status.padEnd(2)} ${file.originalPath ? `${file.originalPath} → ` : ''}${file.path}`).join('\n'), diff: visibleDiff, diffTruncated, filesTruncated, files }
}

function readDiff(workspace: string, args: string[]) {
  return readGitOutput(workspace, args, MAX_DIFF_CHARACTERS)
}

function readGitOutput(workspace: string, args: string[], limit: number) {
  return new Promise<{ stdout: string; truncated: boolean }>((resolve, reject) => {
    const child = spawn('git', args, { cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''; let truncated = false
    let settled = false
    let timedOut = false
    let killTimer: NodeJS.Timeout | undefined
    const timeoutError = new Error('A leitura do Git excedeu o limite de 30 segundos.')
    const finish = (failure?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (killTimer) clearTimeout(killTimer)
      if (failure) reject(failure)
      else resolve({ stdout, truncated })
    }
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
      killTimer = setTimeout(() => finish(timeoutError), 5_000)
    }, 30_000)
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length >= limit) { truncated = true; return }
      const remaining = limit - stdout.length
      const text = chunk.toString()
      stdout += text.slice(0, remaining)
      if (text.length > remaining) truncated = true
    })
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-64_000) })
    child.stdout.on('error', (error) => finish(timedOut ? timeoutError : error))
    child.stderr.on('error', (error) => finish(timedOut ? timeoutError : error))
    child.on('error', (error) => finish(timedOut ? timeoutError : error))
    child.on('close', (code) => {
      if (timedOut) finish(timeoutError)
      else if (code === 0) finish()
      else finish(new Error(redactLogText(stderr.slice(0, 2_000)) || `Git encerrou com código ${code ?? 'desconhecido'}.`))
    })
  })
}

export function parsePorcelainZ(output: string) {
  const records = output.split('\0')
  const files: Array<{ path: string; status: string; originalPath?: string }> = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record) continue
    const status = record.slice(0, 2).trim() || 'M'
    const path = record.slice(3)
    if (status.includes('R') || status.includes('C')) {
      const originalPath = records[index + 1]
      index += 1
      files.push({ status, path, ...(originalPath ? { originalPath } : {}) })
    } else files.push({ status, path })
  }
  return files
}

import { dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { LocalDatabase } from '../database/Database'
import { DocumentUpdateService } from '../documents/DocumentUpdateService'
import { resolveExecutable } from '../runtime/resolveExecutable'
import { getAuthorizedConversation } from './conversationAccess'
import { assertInsideWorkspace, resolveWorkspaceFile } from './fileAccess'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import { applyMarkdownSchema, exportDocumentSchema, prepareMarkdownSchema } from '../../shared/ipc/schemas'
import { WORKSPACE_READ_LIMITS } from '../../shared/constants'
import { readWorkspaceFile } from '../security/ExecutionPolicy'

export function registerDocumentsIpc(win: BrowserWindow, database: LocalDatabase, documentUpdates: DocumentUpdateService, registrar?: SafeIpcMain) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar

  ipcMain.handle(IPC_CHANNELS.documents.prepareMarkdown, async (_event, value: unknown) => {
    const data = prepareMarkdownSchema.parse(value)
    const conversation = getAuthorizedConversation(database, data.conversationId)
    const result = await dialog.showSaveDialog(win, { title: 'Salvar documento Markdown', defaultPath: path.join(conversation.workspace, safeName(data.name, '.md')), filters: [{ name: 'Markdown', extensions: ['md'] }] })
    if (result.canceled || !result.filePath) return null
    assertInsideWorkspace(result.filePath, conversation.workspace)
    return documentUpdates.preview(conversation.workspace, result.filePath, data.content)
  })

  ipcMain.handle(IPC_CHANNELS.documents.applyMarkdown, async (_event, value: unknown) => {
    const data = applyMarkdownSchema.parse(value)
    const conversation = getAuthorizedConversation(database, data.conversationId)
    const action = data.strategy === 'append' ? 'Anexar conteúdo' : 'Substituir documento'
    const confirmation = await dialog.showMessageBox(win, {
      type: data.strategy === 'replace' ? 'warning' : 'info',
      buttons: ['Cancelar', action],
      defaultId: 0,
      cancelId: 0,
      title: 'Aplicar atualização de documentação',
      message: `${action} em ${path.basename(data.target)}?`,
      detail: 'O arquivo só será gravado se permanecer igual ao conteúdo exibido no preview.',
    })
    if (confirmation.response !== 1) return null
    const applied = await documentUpdates.apply(conversation.workspace, data.target, data.generated, data.strategy, data.expectedHash)
    database.addArtifact(data.conversationId, conversation.workspace, 'document', path.basename(applied.target), applied.target, applied.content, { format: 'md', strategy: data.strategy })
    return { target: applied.target, strategy: applied.strategy }
  })

  ipcMain.handle(IPC_CHANNELS.documents.export, async (_event, value: unknown) => {
    const data = exportDocumentSchema.parse(value)
    const conversation = getAuthorizedConversation(database, data.conversationId)
    const pandocPath = await resolveExecutable('pandoc')
    if (!pandocPath) throw new Error('Pandoc não foi encontrado no PATH.')
    const result = await dialog.showSaveDialog(win, { title: `Exportar ${data.format.toUpperCase()}`, defaultPath: path.join(conversation.workspace, `documento.${data.format}`), filters: [{ name: data.format.toUpperCase(), extensions: [data.format] }] })
    if (result.canceled || !result.filePath) return null
    const target = resolveWorkspaceFile(result.filePath, conversation.workspace)
    const temporary = resolveWorkspaceFile(`${target}.tmp-${process.pid}-${randomUUID()}`, conversation.workspace)
    try {
      await pipeCommand(pandocPath, ['-f', 'markdown', '-t', data.format, '-o', temporary], data.content, conversation.workspace)
      const revalidatedTarget = resolveWorkspaceFile(result.filePath, conversation.workspace)
      if (revalidatedTarget !== target) throw new Error('O destino da exportação mudou depois da seleção.')
      await fs.promises.rename(temporary, target)
      await fs.promises.chmod(target, 0o600)
      const artifactContent = data.format === 'html'
        ? (await readWorkspaceFile(target, conversation.workspace, WORKSPACE_READ_LIMITS.documentBytes)).content.toString('utf8')
        : null
      database.addArtifact(data.conversationId, conversation.workspace, 'document', path.basename(target), target, artifactContent, { format: data.format })
      return target
    } finally {
      await fs.promises.unlink(temporary).catch(() => undefined)
    }
  })

  return () => { if (ownsRegistrar) ipcMain.dispose() }
}

function safeName(name: string, extension: string) {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '-')
  return base.endsWith(extension) ? base : `${base}${extension}`
}

function pipeCommand(command: string, args: string[], input: string, cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'ignore', 'pipe'] })
    let error = ''
    let settled = false
    let timedOut = false
    let killTimer: NodeJS.Timeout | undefined
    const finish = (failure?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      if (failure) reject(failure)
      else resolve()
    }
    const timeoutError = new Error('A exportação excedeu o limite de 60 segundos.')
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
      killTimer = setTimeout(() => finish(timeoutError), 5_000)
    }, 60_000)
    child.stderr.on('data', (chunk) => { error = `${error}${chunk.toString()}`.slice(-64_000) })
    child.stdin.on('error', (failure) => finish(timedOut ? timeoutError : failure))
    child.on('error', (failure) => finish(timedOut ? timeoutError : failure))
    child.on('close', (code) => {
      if (timedOut) finish(timeoutError)
      else if (code === 0) finish()
      else finish(new Error(error || `Pandoc encerrou com código ${code}.`))
    })
    child.stdin.end(input)
  })
}

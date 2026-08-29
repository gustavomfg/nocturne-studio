import { dialog, shell, type BrowserWindow } from 'electron'
import path from 'node:path'
import type { LocalDatabase } from '../database/Database'
import { isExternalOpenBlocked, readWorkspaceFile, resolveExistingWorkspacePath, sanitizeWorkspaceReadError, statWorkspaceFile } from '../security/ExecutionPolicy'
import { fileActionSchema, filePreviewSchema, idSchema } from '../../shared/ipc/schemas'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import { WORKSPACE_READ_LIMITS } from '../../shared/constants'
import { getAuthorizedConversation } from './conversationAccess'
import { isTextFile } from './fileAccess'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'

export function registerFilesIpc(win: BrowserWindow, database: LocalDatabase, registrar?: SafeIpcMain) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar
  ipcMain.handle(IPC_CHANNELS.files.attach, async (_event, value: unknown) => {
    const conversation = getAuthorizedConversation(database, idSchema.parse(value))
    const result = await dialog.showOpenDialog(win, {
      title: 'Anexar arquivos de texto', defaultPath: conversation.workspace, properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Arquivos do projeto', extensions: ['txt', 'md', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'xml', 'yaml', 'yml', 'toml', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'sh', 'sql', 'env', 'ini'] }, { name: 'Todos os arquivos', extensions: ['*'] }],
    })
    if (result.canceled) return []
    return (await Promise.all(result.filePaths.map(async (filePath) => {
      const inspected = await statWorkspaceFile(filePath, conversation.workspace)
      const stat = inspected.stat
      if (!stat.isFile()) throw new Error(`${path.basename(filePath)} não é um arquivo válido.`)
      if (stat.size > WORKSPACE_READ_LIMITS.attachmentBytes) throw new Error(`${path.basename(filePath)} excede o limite de 1 MB.`)
      return { path: path.relative(conversation.workspace, inspected.path), name: path.basename(inspected.path), size: stat.size }
    })))
  })

  ipcMain.handle(IPC_CHANNELS.files.open, async (_event, value: unknown) => {
    const data = fileActionSchema.parse(value)
    const conversation = getAuthorizedConversation(database, data.conversationId)
    const filePath = resolveExistingWorkspacePath(data.filePath, conversation.workspace)
    if (data.action === 'folder') {
      shell.showItemInFolder(resolveExistingWorkspacePath(data.filePath, conversation.workspace))
      return
    }
    if (isExternalOpenBlocked(filePath)) throw new Error('Abrir executáveis, atalhos, URLs e scripts diretamente não é permitido por segurança.')
    const revalidatedPath = resolveExistingWorkspacePath(data.filePath, conversation.workspace)
    const error = await shell.openPath(revalidatedPath)
    if (error) throw new Error(error)
  })

  ipcMain.handle(IPC_CHANNELS.files.preview, async (_event, value: unknown) => {
    const data = filePreviewSchema.parse(value)
    const conversation = getAuthorizedConversation(database, data.conversationId)
    let file
    try {
      file = await readWorkspaceFile(data.filePath, conversation.workspace, WORKSPACE_READ_LIMITS.documentBytes)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') throw new Error('Arquivo não encontrado.')
      if (code === 'EFBIG') throw new Error('Preview limitado a arquivos de até 2 MB.')
      throw sanitizeWorkspaceReadError(error, 'Não foi possível ler o arquivo com segurança.')
    }
    const filePath = file.path
    const stat = file.stat
    const extension = path.extname(filePath).toLowerCase()
    const imageMime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' } as Record<string, string>)[extension]
    if (imageMime) return { kind: 'image', name: path.basename(filePath), filePath, mime: imageMime, content: `data:${imageMime};base64,${file.content.toString('base64')}`, size: stat.size }
    if (!isTextFile(extension)) throw new Error('Este formato não possui preview interno.')
    return { kind: extension === '.md' ? 'markdown' : 'text', name: path.basename(filePath), filePath, mime: 'text/plain', content: file.content.toString('utf8'), size: stat.size }
  })

  return () => { if (ownsRegistrar) ipcMain.dispose() }
}

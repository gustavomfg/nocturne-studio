import { dialog, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { z } from 'zod'
import type { LocalDatabase } from '../database/Database'
import { workspaceFavoriteSchema, workspaceToolSchema } from '../../shared/ipc/schemas'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'
import { assertSafeWorkspaceScope, inspectWorkspaceScope } from '../security/WorkspaceTrust'
import { WorkspaceChangeWatcher } from '../workspaces/WorkspaceChangeWatcher'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import { resolveExecutable } from '../runtime/resolveExecutable'

interface Dependencies {
  ensureWorkspace(workspace: string): Promise<void>
  assertKnownWorkspace(value: string): string
  run(command: string, args: string[], cwd: string): Promise<unknown>
}

export function registerWorkspaceIpc(win: BrowserWindow, database: LocalDatabase, dependencies: Dependencies, registrar?: SafeIpcMain) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar
  const changeWatcher = new WorkspaceChangeWatcher((event) => win.webContents.send(IPC_CHANNELS.workspace.changed, event))
  ipcMain.handle(IPC_CHANNELS.workspace.select, async (_event, value: unknown) => {
    const expected = z.string().trim().min(1).max(4_000).optional().parse(value)
    const expectedInspection = expected ? inspectWorkspaceScope(expected) : null
    if (expectedInspection?.availability === 'invalid' || expectedInspection?.availability === 'permission-denied') {
      throw new Error(expectedInspection.message)
    }
    const expectedWorkspace = expectedInspection?.path ?? null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: expectedWorkspace ? 'Reautorizar workspace' : 'Selecionar workspace',
      ...(expectedWorkspace ? { defaultPath: expectedWorkspace } : {}),
    })
    if (result.canceled || !result.filePaths[0]) return null
    const workspace = assertSafeWorkspaceScope(result.filePaths[0])
    if (expectedWorkspace && workspace !== expectedWorkspace && expectedInspection?.availability !== 'missing') {
      throw new Error('Selecione a mesma pasta associada à conversa restaurada.')
    }
    if (expected && expectedWorkspace && workspace !== expectedWorkspace) {
      const confirmation = await dialog.showMessageBox(win, {
        type: 'warning',
        title: 'Atualizar localização do projeto?',
        message: 'A pasta original não foi encontrada.',
        detail: `O Nocturne Studio atualizará conversas, memórias, sugestões, artefatos e configurações deste workspace para:\n\n${workspace}`,
        buttons: ['Cancelar', 'Atualizar localização'],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
      })
      if (confirmation.response !== 1) return null
      await dependencies.ensureWorkspace(workspace)
      database.relocateWorkspace(expected, workspace)
      return workspace
    }
    await dependencies.ensureWorkspace(workspace)
    const storedWorkspace = expected ?? workspace
    database.touchWorkspace(storedWorkspace)
    return storedWorkspace
  })
  ipcMain.handle(IPC_CHANNELS.workspace.validate, (_event, value: unknown) => { try { return assertSafeWorkspaceScope(z.string().min(1).parse(value)) } catch { return null } })
  ipcMain.handle(IPC_CHANNELS.workspace.list, () => database.listWorkspaces().map((workspace) => {
    const inspection = inspectWorkspaceScope(workspace.path)
    return {
      ...workspace,
      authorized: workspace.authorized && inspection.availability === 'available',
      availability: inspection.availability,
      ...(inspection.message ? { availabilityMessage: inspection.message } : {}),
    }
  }))
  ipcMain.handle(IPC_CHANNELS.workspace.remove, (_event, value: unknown) => database.removeWorkspace(z.string().min(1).parse(value)))
  ipcMain.handle(IPC_CHANNELS.workspace.favorite, (_event, value: unknown) => { const data = workspaceFavoriteSchema.parse(value); dependencies.assertKnownWorkspace(data.workspace); database.setWorkspaceFavorite(data.workspace, data.favorite) })
  ipcMain.handle(IPC_CHANNELS.workspace.watch, (_event, value: unknown) => {
    const requested = z.string().trim().min(1).max(4_000).nullable().parse(value)
    if (requested === null) {
      return changeWatcher.stop()
    }
    const workspace = dependencies.assertKnownWorkspace(requested)
    return changeWatcher.start(workspace)
  })
  ipcMain.handle(IPC_CHANNELS.workspace.openTool, async (_event, value: unknown) => {
    const data = workspaceToolSchema.parse(value); const workspace = dependencies.assertKnownWorkspace(data.workspace)
    if (!fs.existsSync(workspace)) throw new Error('Workspace não encontrado.')
    if (data.tool === 'editor') {
      if (!(await resolveExecutable('webstorm'))) throw new Error('Não foi possível abrir o WebStorm. Verifique se o comando “webstorm” está no PATH e é executável.')
      try { await dependencies.run('webstorm', [workspace], workspace) } catch { throw new Error('Não foi possível abrir o WebStorm. Verifique se o comando “webstorm” está no PATH.') }
      return
    }
    const terminal = process.platform === 'win32' ? ['cmd', ['/K', 'cd', '/d', workspace]] as const : process.platform === 'darwin' ? ['open', ['-a', 'Terminal', workspace]] as const : ['x-terminal-emulator', ['--working-directory', workspace]] as const
    if (process.platform !== 'win32' && process.platform !== 'darwin' && !(await resolveExecutable(terminal[0]))) {
      throw new Error('Terminal não encontrado. Instale x-terminal-emulator ou configure um terminal alternativo.')
    }
    await new Promise<void>((resolve, reject) => {
      const child = spawn(terminal[0], [...terminal[1]], { cwd: workspace, detached: true, stdio: 'ignore' })
      child.once('error', () => reject(new Error('Não foi possível abrir o terminal. Instale ou configure o terminal padrão do sistema.')))
      child.once('spawn', () => { child.unref(); resolve() })
    })
  })
  return async () => {
    if (ownsRegistrar) ipcMain.dispose()
    await changeWatcher.stop()
  }
}

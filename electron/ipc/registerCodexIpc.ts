import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/ipc/channels'
import type { AiExecutionCoordinator } from '../ai/AiExecutionCoordinator'
import { CodexAccountService } from '../codex/CodexAccountService'
import { safeIpcMain, type SafeIpcMain } from './safeIpc'

export function registerCodexIpc(win: BrowserWindow, codexAccount: CodexAccountService, aiExecutions: AiExecutionCoordinator, registrar?: SafeIpcMain) {
  const ipcMain = registrar ?? safeIpcMain(win)
  const ownsRegistrar = !registrar
  const codexStatus = async () => {
    const account = await codexAccount.status()
    if (!account.installed || !account.compatible) return account
    try {
      const protocol = await aiExecutions.checkCodexProtocol()
      return { ...account, protocolCompatible: true, serverVersion: protocol.serverVersion }
    } catch (error) {
      return {
        ...account,
        state: 'internal-error' as const,
        protocolCompatible: false,
        error: `O Codex CLI foi encontrado, mas o App Server não respondeu com um protocolo compatível: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  ipcMain.handle(IPC_CHANNELS.codex.status, () => codexStatus())
  ipcMain.handle(IPC_CHANNELS.codex.login, async () => {
    await codexAccount.login()
    return codexStatus()
  })
  ipcMain.handle(IPC_CHANNELS.codex.logout, () => codexAccount.logout())
  ipcMain.handle(IPC_CHANNELS.codex.models, async () => {
    const account = await codexAccount.status()
    if (!account.authenticated || account.authenticationMethod !== 'chatgpt') throw new Error('Conecte uma conta ChatGPT antes de listar os modelos do Codex.')
    return aiExecutions.listCodexModels()
  })

  return () => { if (ownsRegistrar) ipcMain.dispose() }
}

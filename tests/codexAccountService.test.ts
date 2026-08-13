import { describe, expect, it, vi } from 'vitest'
import { CodexAccountService } from '../electron/codex/CodexAccountService'

describe('CodexAccountService', () => {
  it('distingue login ChatGPT da autenticação por API key', async () => {
    const chatGpt = new CodexAccountService(async (args) => ({
      stdout: args[0] === '--version'
        ? 'codex-cli 0.145.0'
        : 'Logged in using ChatGPT',
      stderr: '',
    }))
    await expect(chatGpt.status()).resolves.toEqual({
      state: 'ready',
      installed: true,
      authenticated: true,
      compatible: true,
      version: '0.145.0',
      minimumVersion: '0.145.0',
      recommendedVersion: '0.146.0',
      minimumSatisfied: true,
      recommended: false,
      authenticationMethod: 'chatgpt',
    })

    const apiKey = new CodexAccountService(async (args) => ({
      stdout: args[0] === '--version'
        ? 'codex-cli 0.145.0'
        : 'Logged in using an API key',
      stderr: '',
    }))
    await expect(apiKey.status()).resolves.toMatchObject({
      authenticated: true,
      authenticationMethod: 'api-key',
    })
  })

  it('executa o login no navegador e confirma a conta antes de concluir', async () => {
    let authenticated = false
    const run = vi.fn(async (args: string[]) => {
      if (args[0] === '--version') return { stdout: 'codex-cli 0.145.0', stderr: '' }
      if (args[0] === 'login' && args[1] === 'status') {
        if (!authenticated) throw new Error('Not logged in')
        return { stdout: 'Logged in using ChatGPT', stderr: '' }
      }
      authenticated = true
      return { stdout: '', stderr: '' }
    })
    const service = new CodexAccountService(run)
    await expect(service.login()).resolves.toMatchObject({
      authenticated: true,
      authenticationMethod: 'chatgpt',
    })
    expect(run).toHaveBeenCalledWith(['login'], 600_000)
  })

  it('aceita versões futuras acima do mínimo e deixa o handshake validar o protocolo', async () => {
    const service = new CodexAccountService(async (args) => ({
      stdout: args[0] === '--version'
        ? 'codex-cli 0.147.0'
        : 'Logged in using ChatGPT',
      stderr: '',
    }))
    await expect(service.login()).resolves.toMatchObject({
      state: 'ready',
      compatible: true,
      minimumSatisfied: true,
      recommended: false,
    })
  })

  it('aceita a versão 0.146.0 após validação explícita do contrato', async () => {
    const service = new CodexAccountService(async (args) => ({
      stdout: args[0] === '--version'
        ? 'codex-cli 0.146.0'
        : 'Logged in using ChatGPT',
      stderr: '',
    }))
    await expect(service.status()).resolves.toMatchObject({
      installed: true,
      authenticated: true,
      compatible: true,
      version: '0.146.0',
      recommended: true,
      authenticationMethod: 'chatgpt',
    })
  })

  it('distingue versão abaixo do mínimo e falha interna da ausência do executável', async () => {
    const outdated = new CodexAccountService(async (args) => ({
      stdout: args[0] === '--version' ? 'codex-cli 0.144.0' : '',
      stderr: '',
    }))
    await expect(outdated.status()).resolves.toMatchObject({
      state: 'incompatible',
      installed: true,
      minimumSatisfied: false,
    })

    const internalError = new CodexAccountService(async () => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
    })
    await expect(internalError.status()).resolves.toMatchObject({
      state: 'internal-error',
      installed: false,
      error: expect.stringContaining('verificar'),
    })
  })
})

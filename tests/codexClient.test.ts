import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { CodexClient, type CodexProcessAdapter } from '../electron/codex/CodexClient'
import type { RpcMessage, RpcRequest } from '../electron/codex/protocol'

class FakeCodexProcess extends EventEmitter implements CodexProcessAdapter {
  sent: RpcMessage[] = []
  running = false
  starts = 0

  start() {
    this.starts += 1
    this.running = true
  }

  send(message: RpcMessage) {
    if (!this.running) throw new Error('Processo indisponível.')
    this.sent.push(message)
  }

  stop() {
    if (!this.running) return
    this.running = false
    this.emit('exit', 0, null, true)
  }

  isRunning() {
    return this.running
  }

  get pid() {
    return this.running ? 1234 : null
  }

  get path() {
    return 'codex'
  }

  request(method: string) {
    return [...this.sent].reverse().find(
      (message): message is RpcRequest => 'method' in message
        && 'id' in message
        && message.method === method,
    )
  }

  respond(method: string, result: unknown = method === 'initialize' ? {
    userAgent: 'codex-cli/0.146.0',
    codexHome: '/tmp/codex',
    platformFamily: 'unix',
    platformOs: 'linux',
  } : {}) {
    const request = this.request(method)
    if (!request) throw new Error(`Request ausente: ${method}`)
    this.emit('message', { id: request.id, result })
  }
}

async function waitForRequest(process: FakeCodexProcess, method: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (process.request(method)) return
    await Promise.resolve()
  }
  throw new Error(`Request não enviado: ${method}`)
}

async function waitForRequestCount(process: FakeCodexProcess, method: string, count: number) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const requests = process.sent.filter(
      (message) => 'method' in message && 'id' in message && message.method === method,
    )
    if (requests.length >= count) return
    await Promise.resolve()
  }
  throw new Error(`Quantidade de requests não alcançada: ${method} (${count})`)
}

async function readyClient() {
  const process = new FakeCodexProcess()
  const client = new CodexClient(process)
  const started = client.start()
  process.respond('initialize')
  await started
  return { client, process }
}

async function createThread(client: CodexClient, process: FakeCodexProcess) {
  const pending = client.createThread('/workspace')
  await waitForRequest(process, 'thread/start')
  process.respond('thread/start', { thread: { id: 'thread-1' } })
  await pending
}

describe('CodexClient', () => {
  it('valida o handshake do protocolo antes de declarar o App Server compatível', async () => {
    const { client, process } = await readyClient()
    const checked = client.checkProtocol()
    await waitForRequest(process, 'config/read')
    process.respond('config/read', {})
    await expect(checked).resolves.toEqual({
      compatible: true,
      serverVersion: 'codex-cli/0.146.0',
    })
  })

  it('recusa o protocolo quando a leitura de configuração não é suportada', async () => {
    const { client, process } = await readyClient()
    const checked = client.checkProtocol()
    await waitForRequest(process, 'config/read')
    const request = process.request('config/read')
    expect(request).toBeDefined()
    process.emit('message', {
      id: request?.id,
      error: { code: -32601, message: 'Método não encontrado' },
    })

    await expect(checked).rejects.toThrow('Método não encontrado')
  })

  it('reinicia o transporte antes de reconectar após uma falha interna', async () => {
    const { client, process } = await readyClient()
    process.emit('error', new Error('transporte inválido'))
    expect(client.status).toBe('failed')

    const restarted = client.start()
    await waitForRequestCount(process, 'initialize', 2)
    const initializeRequests = process.sent.filter(
      (message): message is RpcRequest =>
        'method' in message && 'id' in message && message.method === 'initialize',
    )
    expect(initializeRequests).toHaveLength(2)
    process.emit('message', {
      id: initializeRequests[1].id,
      result: {
        userAgent: 'codex-cli/0.146.0',
        codexHome: '/tmp/codex',
        platformFamily: 'unix',
        platformOs: 'linux',
      },
    })
    await restarted
    expect(process.starts).toBe(2)
    expect(client.status).toBe('ready')
  })
  it('lista e valida os modelos disponíveis para a conta', async () => {
    const { client, process } = await readyClient()
    const listed = client.listModels()
    await waitForRequest(process, 'model/list')
    expect(process.request('model/list')?.params).toEqual({
      limit: 100,
      includeHidden: false,
    })
    process.respond('model/list', {
      data: [
        {
          id: 'gpt-5.6-sol',
          model: 'gpt-5.6-sol',
          displayName: 'GPT-5.6 Sol',
          defaultReasoningEffort: 'medium',
          isDefault: true,
          hidden: false,
        },
        {
          id: 'gpt-5.6-luna',
          model: 'gpt-5.6-luna',
          displayName: 'GPT-5.6 Luna',
          isDefault: false,
          hidden: false,
        },
      ],
      nextCursor: null,
    })
    await expect(listed).resolves.toEqual([
      {
        model: 'gpt-5.6-sol',
        displayName: 'GPT-5.6 Sol',
        defaultReasoningEffort: 'medium',
        isDefault: true,
      },
      {
        model: 'gpt-5.6-luna',
        displayName: 'GPT-5.6 Luna',
        isDefault: false,
      },
    ])
  })

  it('inicializa threads efêmeras e mantém Build limitado ao workspace', async () => {
    const { client, process } = await readyClient()
    const created = client.createThread('/workspace')
    await waitForRequest(process, 'thread/start')
    expect(process.request('thread/start')?.params).toMatchObject({
      cwd: '/workspace',
      runtimeWorkspaceRoots: ['/workspace'],
      ephemeral: false,
    })
    process.respond('thread/start', { thread: { id: 'thread-1' } })
    await created

    const turn = client.sendTurn(
      'thread-1',
      '/workspace',
      'Implemente',
      { sandbox: 'workspace-write', approvalPolicy: 'on-request' },
    )
    await waitForRequest(process, 'turn/start')
    expect(process.request('turn/start')?.params).toMatchObject({
      approvalPolicy: 'on-request',
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: ['/workspace'],
        networkAccess: false,
      },
      additionalContext: {
        'nocturne.agent-mode': {
          value: expect.stringContaining('Build Mode'),
        },
      },
    })
    process.respond('turn/start', { turn: { id: 'turn-1' } })
    await expect(turn).resolves.toBe('turn-1')
  })

  it('retoma uma thread persistida reaplicando os limites atuais do workspace', async () => {
    const { client, process } = await readyClient()
    const resumed = client.resumeThread(
      'thread-1',
      '/workspace',
      { model: 'gpt-5.6-luna', sandbox: 'read-only', approvalPolicy: 'untrusted' },
      'contexto',
    )
    await waitForRequest(process, 'thread/resume')
    expect(process.request('thread/resume')?.params).toMatchObject({
      threadId: 'thread-1',
      cwd: '/workspace',
      runtimeWorkspaceRoots: ['/workspace'],
      approvalPolicy: 'untrusted',
      approvalsReviewer: 'user',
      sandbox: 'read-only',
      model: 'gpt-5.6-luna',
      excludeTurns: true,
    })
    process.respond('thread/resume', { thread: { id: 'thread-1' } })
    await expect(resumed).resolves.toBe('thread-1')
  })

  it('força Review para somente leitura independentemente da configuração', async () => {
    const { client, process } = await readyClient()
    await createThread(client, process)
    const turn = client.sendTurn(
      'thread-1',
      '/workspace',
      'Revise',
      { sandbox: 'workspace-write' },
      [],
      '',
      'review',
    )
    await waitForRequest(process, 'turn/start')
    expect(process.request('turn/start')?.params).toMatchObject({
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
    })
    process.respond('turn/start', { turn: { id: 'turn-1' } })
    await turn
  })

  it('encaminha o modelo escolhido para a thread e para o turno', async () => {
    const { client, process } = await readyClient()
    const created = client.createThread('/workspace', { model: 'gpt-5.6-luna' })
    await waitForRequest(process, 'thread/start')
    expect(process.request('thread/start')?.params).toMatchObject({
      model: 'gpt-5.6-luna',
    })
    process.respond('thread/start', { thread: { id: 'thread-1' } })
    await created

    const turn = client.sendTurn(
      'thread-1',
      '/workspace',
      'Revise',
      { model: 'gpt-5.6-luna' },
      [],
      '',
      'review',
    )
    await waitForRequest(process, 'turn/start')
    expect(process.request('turn/start')?.params).toMatchObject({
      model: 'gpt-5.6-luna',
    })
    process.respond('turn/start', { turn: { id: 'turn-1' } })
    await turn
  })

  it('encaminha aprovação e cancelamento ao turno ativo', async () => {
    const { client, process } = await readyClient()
    await createThread(client, process)
    const turn = client.sendTurn('thread-1', '/workspace', 'Execute')
    await waitForRequest(process, 'turn/start')
    process.respond('turn/start', { turn: { id: 'turn-1' } })
    await turn

    process.emit('message', {
      id: 88,
      method: 'item/commandExecution/requestApproval',
      params: { itemId: 'approval-1', command: ['npm', 'test'] },
    })
    await client.resolveApproval('approval-1', true, true)
    expect(process.sent[process.sent.length - 1]).toEqual({
      id: 88,
      result: { decision: 'acceptForSession' },
    })

    const interrupted = client.interrupt('thread-1')
    await waitForRequest(process, 'turn/interrupt')
    expect(process.request('turn/interrupt')?.params).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
    })
    process.respond('turn/interrupt')
    await interrupted
  })
})

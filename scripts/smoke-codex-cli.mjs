import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const executable = process.env.CODEX_PATH || 'codex'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-studio-contract-'))
const reportPath = path.resolve(process.env.CODEX_SMOKE_REPORT || 'test-results/codex-contract-smoke.json')
const packageMetadata = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
const compatibility = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'shared/codex-compatibility.json'), 'utf8'))
const repositorySha = gitHead().toLowerCase()
const expectedSha = (process.env.CODEX_SMOKE_EXPECTED_SHA || process.env.GITHUB_SHA || repositorySha).trim().toLowerCase()
const report = {
  ok: false,
  repositorySha,
  expectedSha,
  ref: process.env.CODEX_SMOKE_REF || process.env.GITHUB_REF || '',
  workflowRef: process.env.GITHUB_REF || '',
  workflowRunId: process.env.GITHUB_RUN_ID || '',
  workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT || '',
  platform: process.platform,
  arch: process.arch,
  runner: process.env.RUNNER_OS || process.platform,
  timestamp: new Date().toISOString(),
  nocturneVersion: typeof packageMetadata.version === 'string' ? packageMetadata.version : '',
  version: '',
  codexVersion: '',
  minimumSupportedVersion: compatibility.minimum,
  minimumSatisfied: false,
  knownVersion: false,
  authenticationChecked: false,
  authenticatedSession: false,
  authenticationMethod: '',
  appServerHandshake: false,
  initialize: false,
  modelList: false,
  configRead: false,
  sessionStarted: false,
  threadStart: false,
  turnStart: false,
  turnCompleted: false,
  agentResponse: false,
  requestResponseContract: false,
  interrupt: false,
  cleanShutdown: false,
  shutdown: false,
  approvalsObserved: 0,
  approvalsDeclined: 0,
  notifications: 0,
  stderrBytes: 0,
  unexpectedStdoutLines: 0,
}
let child
let lines
let nextId = 1
let intentionalShutdown = false
let unexpectedExit = false
const pending = new Map()
const turnWaiters = new Map()
const itemWaiters = new Map()
let responseText = ''

try {
  if (!isSha(repositorySha) || !isSha(expectedSha) || repositorySha !== expectedSha) {
    throw new Error('O smoke precisa executar exatamente sobre o SHA candidato informado.')
  }

  report.version = readVersion()
  report.codexVersion = report.version
  const semanticVersion = report.version.match(/\d+\.\d+\.\d+/)?.[0]
  report.minimumSatisfied = Boolean(semanticVersion && compareSemver(semanticVersion, compatibility.minimum) >= 0)
  report.knownVersion = Boolean(semanticVersion && compatibility.verified.includes(semanticVersion))
  if (!report.minimumSatisfied) throw new Error(`A versão instalada está abaixo do mínimo suportado (${compatibility.minimum}).`)

  const authentication = readAuthentication()
  report.authenticationChecked = true
  report.authenticatedSession = authentication.authenticated
  report.authenticationMethod = authentication.method
  if (!authentication.authenticated) throw new Error('O Codex CLI não confirmou uma sessão autenticada.')

  child = spawn(executable, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env })
  child.stderr.on('data', (chunk) => {
    report.stderrBytes += Buffer.byteLength(chunk)
  })
  lines = readline.createInterface({ input: child.stdout })
  lines.on('line', handleLine)
  child.on('exit', (code) => {
    if (!intentionalShutdown) unexpectedExit = true
    rejectPending(`App Server encerrou antes do fim do smoke (código ${code ?? 'desconhecido'}).`)
  })
  child.on('error', (error) => rejectPending(`Não foi possível iniciar o App Server: ${error.message}`))

  const initialized = await call('initialize', {
    clientInfo: { name: 'nocturne-contract-smoke', title: 'Nocturne contract smoke', version: packageMetadata.version },
    capabilities: { experimentalApi: true, requestAttestation: false },
  })
  if (!isInitializeResponse(initialized)) throw new Error('O handshake do App Server retornou dados inválidos.')
  report.initialize = true
  report.appServerHandshake = true
  notify('initialized')

  const models = await call('model/list', { limit: 100, includeHidden: false })
  if (!Array.isArray(models?.data) || !models.data.some((model) => (
    typeof model?.model === 'string'
    && typeof model?.displayName === 'string'
  ))) {
    throw new Error('model/list não retornou modelos selecionáveis.')
  }
  report.modelList = true

  const configuration = await call('config/read', {})
  if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
    throw new Error('config/read não retornou um objeto de configuração.')
  }
  report.configRead = true

  const created = await call('thread/start', {
    cwd: root,
    runtimeWorkspaceRoots: [root],
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandbox: 'read-only',
    ephemeral: true,
  })
  const threadId = created?.thread?.id
  if (typeof threadId !== 'string' || !threadId) throw new Error('thread/start não retornou um identificador.')
  report.threadStart = true
  report.sessionStarted = true

  const completion = waitForTurnCompletion(threadId)
  const started = await call('turn/start', {
    threadId,
    cwd: root,
    runtimeWorkspaceRoots: [root],
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxPolicy: { type: 'readOnly', networkAccess: false },
    input: [{ type: 'text', text: 'Responda apenas READY. Não use ferramentas.', text_elements: [] }],
  })
  const turnId = started?.turn?.id
  if (typeof turnId !== 'string' || !turnId) throw new Error('turn/start não retornou um identificador.')
  report.turnStart = true
  await completion
  report.turnCompleted = true
  report.agentResponse = /\bREADY\b/i.test(responseText)
  if (!report.agentResponse) throw new Error('O turno concluiu sem a resposta de contrato esperada.')
  report.requestResponseContract = true

  const interruptThread = await call('thread/start', {
    cwd: root,
    runtimeWorkspaceRoots: [root],
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandbox: 'read-only',
    ephemeral: true,
  })
  const interruptThreadId = interruptThread?.thread?.id
  if (typeof interruptThreadId !== 'string' || !interruptThreadId) throw new Error('A thread de cancelamento não retornou um identificador.')
  const itemStarted = waitForItemStarted(interruptThreadId)
  const interruptible = await call('turn/start', {
    threadId: interruptThreadId,
    cwd: root,
    runtimeWorkspaceRoots: [root],
    approvalPolicy: 'on-request',
    approvalsReviewer: 'user',
    sandboxPolicy: { type: 'readOnly', networkAccess: false },
    input: [{ type: 'text', text: 'Use a ferramenta de terminal para executar exatamente: sleep 30', text_elements: [] }],
  })
  const interruptibleTurnId = interruptible?.turn?.id
  if (typeof interruptibleTurnId !== 'string' || !interruptibleTurnId) throw new Error('O segundo turn/start não retornou um identificador.')
  await itemStarted
  await call('turn/interrupt', { threadId: interruptThreadId, turnId: interruptibleTurnId })
  report.interrupt = true
  if (report.unexpectedStdoutLines > 0) throw new Error('O App Server emitiu stdout fora do protocolo JSONL.')
  report.ok = true
} finally {
  report.shutdown = await stopChild()
  report.cleanShutdown = report.shutdown && !unexpectedExit
  if (!report.cleanShutdown) report.ok = false
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

if (!report.ok) throw new Error(`Smoke do contrato falhou. Consulte o relatório sanitizado em ${reportPath}.`)
process.stdout.write(`Contrato autenticado do Codex CLI validado (${report.version}). Relatório: ${reportPath}\n`)

function readVersion() {
  try {
    const output = execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 5_000, maxBuffer: 64_000 })
    return output.match(/\d+\.\d+\.\d+/)?.[0] || ''
  } catch {
    throw new Error('Não foi possível obter a versão do Codex CLI.')
  }
}

function readAuthentication() {
  const result = spawnSync(executable, ['login', 'status'], {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 64_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return parseAuthentication(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
}

function parseAuthentication(output) {
  if (!/logged in|autenticad[oa]|signed in/i.test(output)) return { authenticated: false, method: '' }
  if (/chatgpt/i.test(output)) return { authenticated: true, method: 'chatgpt' }
  if (/api key|api-key/i.test(output)) return { authenticated: true, method: 'api-key' }
  return { authenticated: true, method: 'unknown' }
}

function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5_000 }).trim()
  } catch {
    return ''
  }
}

function isSha(value) {
  return /^[0-9a-f]{40}$/i.test(value)
}

function isInitializeResponse(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.userAgent === 'string'
    && value.userAgent.length > 0
    && value.userAgent.length <= 500
    && typeof value.codexHome === 'string'
    && value.codexHome.length > 0
    && typeof value.platformFamily === 'string'
    && value.platformFamily.length > 0
    && typeof value.platformOs === 'string'
    && value.platformOs.length > 0
}

function call(method, params) {
  if (!child?.stdin.writable) return Promise.reject(new Error('App Server indisponível.'))
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Tempo esgotado em ${method}.`)) }, 60_000)
    pending.set(id, { resolve, reject, timer, method })
    try {
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
    } catch (error) {
      clearTimeout(timer)
      pending.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ method, params })}\n`)
}

function handleLine(line) {
  let message
  try { message = JSON.parse(line) } catch {
    report.unexpectedStdoutLines += 1
    return
  }
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    report.unexpectedStdoutLines += 1
    return
  }
  if (message && 'id' in message && !('method' in message)) {
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(`${request.method} recusado pelo App Server: ${message.error.code ?? 'erro'}`))
    else request.resolve(message.result)
    return
  }
  if (!message?.method) {
    report.unexpectedStdoutLines += 1
    return
  }
  report.notifications += 1
  if (message.method === 'item/agentMessage/delta') responseText = `${responseText}${String(message.params?.delta ?? '')}`.slice(-10_000)
  if (message.method === 'turn/completed') {
    const threadId = String(message.params?.threadId ?? '')
    const waiter = turnWaiters.get(threadId)
    if (waiter) {
      clearTimeout(waiter.timer)
      turnWaiters.delete(threadId)
      waiter.resolve()
    }
  }
  if (message.method === 'item/started') {
    const threadId = String(message.params?.threadId ?? '')
    const waiter = itemWaiters.get(threadId)
    if (waiter) {
      clearTimeout(waiter.timer)
      itemWaiters.delete(threadId)
      waiter.resolve()
    }
  }
  if ('id' in message && new Set(['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/tool/requestUserInput']).has(message.method)) {
    report.approvalsObserved += 1
    child.stdin.write(`${JSON.stringify({ id: message.id, result: { decision: 'decline' } })}\n`)
    report.approvalsDeclined += 1
  } else if ('id' in message) {
    child.stdin.write(`${JSON.stringify({ id: message.id, error: { code: -32601, message: 'Método não suportado pelo smoke.' } })}\n`)
  }
}

function rejectPending(message) {
  for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(message)) }
  pending.clear()
  for (const waiter of turnWaiters.values()) { clearTimeout(waiter.timer); waiter.reject(new Error(message)) }
  turnWaiters.clear()
  for (const waiter of itemWaiters.values()) { clearTimeout(waiter.timer); waiter.reject(new Error(message)) }
  itemWaiters.clear()
}

function waitForTurnCompletion(threadId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { turnWaiters.delete(threadId); reject(new Error('Tempo esgotado aguardando turn/completed.')) }, 60_000)
    turnWaiters.set(threadId, { resolve, reject, timer })
  })
}

function waitForItemStarted(threadId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { itemWaiters.delete(threadId); reject(new Error('Tempo esgotado aguardando item/started para o cancelamento.')) }, 60_000)
    itemWaiters.set(threadId, { resolve, reject, timer })
  })
}

async function stopChild() {
  if (!child) return true
  lines?.close()
  if (child.exitCode !== null || child.signalCode !== null) return !unexpectedExit
  intentionalShutdown = true
  child.kill('SIGTERM')
  const exited = await waitForExit(5_000)
  if (exited) return true
  child.kill('SIGKILL')
  return await waitForExit(2_000)
}

function waitForExit(timeout) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child?.off('exit', onExit)
      resolve(false)
    }, timeout)
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once('exit', onExit)
  })
}

function compareSemver(left, right) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const executable = process.env.CODEX_PATH || 'codex'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-studio-contract-'))
const reportPath = path.resolve(process.env.CODEX_SMOKE_REPORT || 'test-results/codex-contract-smoke.json')
const compatibility = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'shared/codex-compatibility.json'), 'utf8'))
const report = { ok: false, version: '', minimumSatisfied: false, knownVersion: false, initialize: false, modelList: false, configRead: false, threadStart: false, turnStart: false, turnCompleted: false, agentResponse: false, interrupt: false, approvalsObserved: 0, approvalsDeclined: 0, notifications: 0 }
let child
let nextId = 1
const pending = new Map()
const turnWaiters = new Map()
const itemWaiters = new Map()
let responseText = ''

try {
  report.version = execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 5_000 }).trim().slice(0, 100)
  const semanticVersion = report.version.match(/\d+\.\d+\.\d+/)?.[0]
  report.minimumSatisfied = Boolean(semanticVersion && compareSemver(semanticVersion, compatibility.minimum) >= 0)
  report.knownVersion = Boolean(semanticVersion && compatibility.verified.includes(semanticVersion))
  if (!report.minimumSatisfied) throw new Error(`A versão instalada está abaixo do mínimo suportado (${compatibility.minimum}).`)
  child = spawn(executable, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env })
  child.stderr.resume()
  const lines = readline.createInterface({ input: child.stdout })
  lines.on('line', handleLine)
  child.on('exit', (code) => rejectPending(`App Server encerrou antes do fim do smoke (código ${code ?? 'desconhecido'}).`))
  child.on('error', (error) => rejectPending(`Não foi possível iniciar o App Server: ${error.message}`))

  await call('initialize', { clientInfo: { name: 'nocturne-contract-smoke', title: 'Nocturne contract smoke', version: '1' }, capabilities: { experimentalApi: true, requestAttestation: false } })
  report.initialize = true
  notify('initialized')
  const models = await call('model/list', { limit: 100, includeHidden: false })
  if (!Array.isArray(models?.data) || !models.data.some((model) => (
    typeof model?.model === 'string'
    && typeof model?.displayName === 'string'
  ))) {
    throw new Error('model/list não retornou modelos selecionáveis.')
  }
  report.modelList = true
  await call('config/read', {})
  report.configRead = true
  const created = await call('thread/start', { cwd: root, runtimeWorkspaceRoots: [root], approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only', ephemeral: true })
  const threadId = created?.thread?.id
  if (!threadId) throw new Error('thread/start não retornou um identificador.')
  report.threadStart = true
  const completion = waitForTurnCompletion(threadId)
  const started = await call('turn/start', { threadId, cwd: root, runtimeWorkspaceRoots: [root], approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: { type: 'readOnly', networkAccess: false }, input: [{ type: 'text', text: 'Responda apenas READY. Não use ferramentas.', text_elements: [] }] })
  const turnId = started?.turn?.id
  if (!turnId) throw new Error('turn/start não retornou um identificador.')
  report.turnStart = true
  await completion
  report.turnCompleted = true
  report.agentResponse = /\bREADY\b/i.test(responseText)
  if (!report.agentResponse) throw new Error('O turno concluiu sem a resposta de contrato esperada.')
  const interruptThread = await call('thread/start', { cwd: root, runtimeWorkspaceRoots: [root], approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only', ephemeral: true })
  const interruptThreadId = interruptThread?.thread?.id
  if (!interruptThreadId) throw new Error('A thread de cancelamento não retornou um identificador.')
  const itemStarted = waitForItemStarted(interruptThreadId)
  const interruptible = await call('turn/start', { threadId: interruptThreadId, cwd: root, runtimeWorkspaceRoots: [root], approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: { type: 'readOnly', networkAccess: false }, input: [{ type: 'text', text: 'Use a ferramenta de terminal para executar exatamente: sleep 30', text_elements: [] }] })
  const interruptibleTurnId = interruptible?.turn?.id
  if (!interruptibleTurnId) throw new Error('O segundo turn/start não retornou um identificador.')
  await itemStarted
  await call('turn/interrupt', { threadId: interruptThreadId, turnId: interruptibleTurnId })
  report.interrupt = true
  report.ok = true
} finally {
  if (child && !child.killed) child.kill('SIGTERM')
  fs.rmSync(root, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

if (!report.ok) throw new Error(`Smoke do contrato falhou. Consulte o relatório sanitizado em ${reportPath}.`)
process.stdout.write(`Contrato do Codex CLI validado (${report.version}). Relatório: ${reportPath}\n`)

function call(method, params) {
  if (!child?.stdin.writable) return Promise.reject(new Error('App Server indisponível.'))
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Tempo esgotado em ${method}.`)) }, 60_000)
    pending.set(id, { resolve, reject, timer, method })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
  })
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ method, params })}\n`)
}

function handleLine(line) {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message && 'id' in message && !('method' in message)) {
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(`${request.method} recusado pelo App Server: ${message.error.code ?? 'erro'}`))
    else request.resolve(message.result)
    return
  }
  if (!message?.method) return
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

function compareSemver(left, right) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

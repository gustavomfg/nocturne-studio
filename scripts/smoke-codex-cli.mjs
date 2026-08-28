import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const executable = process.env.CODEX_PATH || 'codex'
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-studio-contract-'))
const buildFile = path.join(root, 'build-smoke-inside.txt')
const buildFileContent = 'NOCTURNE_BUILD_SMOKE_OK\n'
let externalRoot = ''
let externalFile = ''
const externalSentinel = 'NOCTURNE_EXTERNAL_SENTINEL\n'
const buildApprovalPolicy = 'untrusted'
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
  buildWorkspacePrepared: false,
  buildThreadStarted: false,
  buildTurnStarted: false,
  buildTurnCompleted: false,
  buildApprovalObserved: 0,
  buildApprovalAccepted: 0,
  buildWriteWithinWorkspace: false,
  buildWorkspaceRootConstrained: false,
  buildNetworkDisabled: false,
  externalPathAttemptObserved: false,
  externalPathBlockedObserved: false,
  externalPathApprovalDeclined: false,
  externalPathRejected: false,
  externalFileUnchanged: false,
  networkTurnStarted: false,
  networkTurnCompleted: false,
  networkAttemptObserved: false,
  networkApprovalObserved: 0,
  networkApprovalDeclined: 0,
  networkAccessBlockedObserved: false,
  networkAccessDenied: false,
  buildCancellationStarted: false,
  buildCancellationCompleted: false,
  interrupt: false,
  cleanShutdown: false,
  shutdown: false,
  workspaceCleanup: false,
  externalCleanup: false,
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
let scenario = 'read-only'
const pending = new Map()
const turnWaiters = new Map()
const itemWaiters = new Map()
let responseText = ''

try {
  if (!isSha(repositorySha) || !isSha(expectedSha) || repositorySha !== expectedSha) {
    throw new Error('O smoke precisa executar exatamente sobre o SHA candidato informado.')
  }

  externalRoot = fs.mkdtempSync(path.join(os.homedir(), '.nocturne-studio-contract-external-'))
  externalFile = path.join(externalRoot, 'build-smoke-outside.txt')
  fs.writeFileSync(externalFile, externalSentinel, { encoding: 'utf8', mode: 0o600 })
  prepareGitWorkspace(root)
  report.buildWorkspacePrepared = true

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

  const buildThread = await call('thread/start', {
    cwd: root,
    runtimeWorkspaceRoots: [root],
    approvalPolicy: buildApprovalPolicy,
    approvalsReviewer: 'user',
    sandbox: 'workspace-write',
    ephemeral: true,
  })
  const buildThreadId = buildThread?.thread?.id
  if (typeof buildThreadId !== 'string' || !buildThreadId) throw new Error('A thread Build não retornou um identificador.')
  report.buildThreadStarted = true

  const buildPolicy = workspaceWritePolicy(root)
  assertBuildPolicy(buildPolicy)
  scenario = 'build-write'
  const buildCompletion = waitForTurnCompletion(buildThreadId)
  const buildStarted = await call('turn/start', {
    threadId: buildThreadId,
    cwd: root,
    runtimeWorkspaceRoots: [root],
    approvalPolicy: buildApprovalPolicy,
    approvalsReviewer: 'user',
    sandboxPolicy: buildPolicy,
    input: [{
      type: 'text',
      text: `Use a ferramenta de terminal agora e crie exatamente o arquivo build-smoke-inside.txt no workspace atual. Execute somente o equivalente a escrever o conteúdo NOCTURNE_BUILD_SMOKE_OK em uma única linha. Não use rede, não toque em outros caminhos e responda BUILD_WRITE_OK após a escrita.`,
      text_elements: [],
    }],
  })
  const buildTurnId = buildStarted?.turn?.id
  if (typeof buildTurnId !== 'string' || !buildTurnId) throw new Error('O turno Build não retornou um identificador.')
  report.buildTurnStarted = true
  const buildCompletionParams = await buildCompletion
  assertTurnSettled(buildCompletionParams, 'Build de escrita')
  report.buildTurnCompleted = true
  if (!report.buildApprovalObserved || !report.buildApprovalAccepted) throw new Error('O turno Build não solicitou e recebeu aprovação para a escrita autorizada.')
  if (fs.readFileSync(buildFile, 'utf8') !== buildFileContent) throw new Error('O turno Build não escreveu o conteúdo esperado no workspace autorizado.')
  report.buildWriteWithinWorkspace = true
  if (fs.readFileSync(externalFile, 'utf8') !== externalSentinel) throw new Error('O smoke alterou o arquivo fora do workspace autorizado.')

  scenario = 'build-external'
  const externalCompletion = waitForTurnCompletion(buildThreadId)
  const externalStarted = await call('turn/start', {
    threadId: buildThreadId,
    cwd: root,
    runtimeWorkspaceRoots: [root],
    approvalPolicy: buildApprovalPolicy,
    approvalsReviewer: 'user',
    sandboxPolicy: buildPolicy,
    input: [{
      type: 'text',
      text: `Use a ferramenta de terminal agora e tente escrever exatamente NOCTURNE_EXTERNAL_SHOULD_NOT_CHANGE no caminho absoluto ${externalFile}. Não escreva no workspace nem em qualquer outro caminho. Se a política bloquear a tentativa ou pedir aprovação, não tente contorná-la e responda EXTERNAL_WRITE_BLOCKED.`,
      text_elements: [],
    }],
  })
  const externalTurnId = externalStarted?.turn?.id
  if (typeof externalTurnId !== 'string' || !externalTurnId) throw new Error('O turno de contenção externa não retornou um identificador.')
  assertTurnSettled(await externalCompletion, 'contenção de path externo')
  report.externalFileUnchanged = fs.readFileSync(externalFile, 'utf8') === externalSentinel
  report.externalPathRejected = report.externalPathApprovalDeclined || report.externalPathBlockedObserved
  if (!report.externalPathAttemptObserved) throw new Error('O turno Build não tentou acessar o path externo de teste.')
  if (!report.externalPathRejected || !report.externalFileUnchanged) throw new Error('A política Build não rejeitou de forma verificável o path externo.')

  scenario = 'build-network'
  const networkCompletion = waitForTurnCompletion(buildThreadId)
  const networkStarted = await call('turn/start', {
    threadId: buildThreadId,
    cwd: root,
    runtimeWorkspaceRoots: [root],
    approvalPolicy: buildApprovalPolicy,
    approvalsReviewer: 'user',
    sandboxPolicy: buildPolicy,
    input: [{
      type: 'text',
      text: 'Use a ferramenta de terminal agora e tente fazer uma única requisição HTTP para http://127.0.0.1:9, com timeout máximo de 1 segundo. Não use outro host, não escreva arquivos e responda NETWORK_BLOCKED se a política impedir a requisição.',
      text_elements: [],
    }],
  })
  const networkTurnId = networkStarted?.turn?.id
  if (typeof networkTurnId !== 'string' || !networkTurnId) throw new Error('O turno de rede não retornou um identificador.')
  report.networkTurnStarted = true
  assertTurnSettled(await networkCompletion, 'restrição de rede')
  report.networkTurnCompleted = true
  report.networkAccessDenied = report.networkApprovalDeclined > 0 || report.networkAccessBlockedObserved
  if (!report.networkAttemptObserved) throw new Error('O turno Build não tentou a operação de rede de teste.')
  if (!report.networkAccessDenied || !report.buildNetworkDisabled) throw new Error('A política Build não comprovou a rede desabilitada.')

  scenario = 'build-cancel'
  const cancellationThread = await call('thread/start', {
    cwd: root,
    runtimeWorkspaceRoots: [root],
    approvalPolicy: buildApprovalPolicy,
    approvalsReviewer: 'user',
    sandbox: 'workspace-write',
    ephemeral: true,
  })
  const cancellationThreadId = cancellationThread?.thread?.id
  if (typeof cancellationThreadId !== 'string' || !cancellationThreadId) throw new Error('A thread de cancelamento Build não retornou um identificador.')
  const cancellationCompletion = waitForTurnCompletion(cancellationThreadId)
  const cancellationItem = waitForItemStarted(cancellationThreadId)
  const cancellationStarted = await call('turn/start', {
    threadId: cancellationThreadId,
    cwd: root,
    runtimeWorkspaceRoots: [root],
    approvalPolicy: buildApprovalPolicy,
    approvalsReviewer: 'user',
    sandboxPolicy: buildPolicy,
    input: [{
      type: 'text',
      text: 'Use a ferramenta de terminal agora para executar node -e "setTimeout(() => {}, 30000)". Não use rede nem altere arquivos. Aguarde até ser interrompido e não responda antes disso.',
      text_elements: [],
    }],
  })
  const cancellationTurnId = cancellationStarted?.turn?.id
  if (typeof cancellationTurnId !== 'string' || !cancellationTurnId) throw new Error('O turno de cancelamento Build não retornou um identificador.')
  await cancellationItem
  report.buildCancellationStarted = true
  await call('turn/interrupt', { threadId: cancellationThreadId, turnId: cancellationTurnId })
  report.interrupt = true
  const cancellationParams = await cancellationCompletion
  report.buildCancellationCompleted = ['interrupted', 'cancelled'].includes(cancellationParams?.turn?.status)
  if (!report.buildCancellationCompleted) throw new Error(`O turno Build não confirmou cancelamento: ${String(cancellationParams?.turn?.status ?? 'desconhecido')}`)

  if (!report.buildWorkspacePrepared
    || !report.buildThreadStarted
    || !report.buildTurnStarted
    || !report.buildTurnCompleted
    || !report.buildWriteWithinWorkspace
    || !report.buildWorkspaceRootConstrained
    || !report.buildNetworkDisabled
    || !report.externalPathRejected
    || !report.externalFileUnchanged
    || !report.networkAccessDenied
    || !report.buildCancellationStarted
    || !report.buildCancellationCompleted) {
    throw new Error('As verificações reais do modo Build não foram concluídas.')
  }
  if (report.unexpectedStdoutLines > 0) throw new Error('O App Server emitiu stdout fora do protocolo JSONL.')
  report.ok = true
} finally {
  report.shutdown = await stopChild()
  report.cleanShutdown = report.shutdown && !unexpectedExit
  if (!report.cleanShutdown) report.ok = false
  fs.rmSync(root, { recursive: true, force: true })
  if (externalRoot) fs.rmSync(externalRoot, { recursive: true, force: true })
  report.workspaceCleanup = !fs.existsSync(root)
  report.externalCleanup = !externalRoot || !fs.existsSync(externalRoot)
  if (!report.workspaceCleanup || !report.externalCleanup) report.ok = false
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

function prepareGitWorkspace(workspace) {
  execFileSync('git', ['init', '--quiet', workspace], { stdio: 'ignore' })
  execFileSync('git', ['-C', workspace, 'config', 'user.name', 'Nocturne Studio Smoke'], { stdio: 'ignore' })
  execFileSync('git', ['-C', workspace, 'config', 'user.email', 'smoke@invalid.example'], { stdio: 'ignore' })
  fs.writeFileSync(path.join(workspace, 'README.md'), '# Codex Build smoke\n', { encoding: 'utf8', mode: 0o600 })
  const status = execFileSync('git', ['-C', workspace, 'status', '--short'], { encoding: 'utf8' })
  if (!status.includes('README.md')) throw new Error('O workspace Git temporário não foi preparado corretamente.')
}

function workspaceWritePolicy(workspace) {
  return {
    type: 'workspaceWrite',
    writableRoots: [workspace],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  }
}

function assertBuildPolicy(policy) {
  if (policy.type !== 'workspaceWrite'
    || !Array.isArray(policy.writableRoots)
    || policy.writableRoots.length !== 1
    || policy.writableRoots[0] !== root
    || policy.networkAccess !== false) {
    throw new Error('A política Build não está confinada ao workspace ou permite rede.')
  }
  report.buildWorkspaceRootConstrained = true
  report.buildNetworkDisabled = true
}

function assertTurnSettled(params, label) {
  const status = params?.turn?.status
  if (!['completed', 'interrupted', 'failed', 'cancelled'].includes(status)) {
    throw new Error(`${label} não terminou em um estado final: ${String(status ?? 'desconhecido')}`)
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
  observeScenario(message)
  if (message.method === 'item/agentMessage/delta') responseText = `${responseText}${String(message.params?.delta ?? '')}`.slice(-10_000)
  if (message.method === 'turn/completed') {
    const threadId = String(message.params?.threadId ?? '')
    const waiter = turnWaiters.get(threadId)
    if (waiter) {
      clearTimeout(waiter.timer)
      turnWaiters.delete(threadId)
      waiter.resolve(message.params)
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
  if ('id' in message && new Set([
    'item/commandExecution/requestApproval',
    'item/fileChange/requestApproval',
    'item/permissions/requestApproval',
  ]).has(message.method)) {
    handleApproval(message)
  } else if ('id' in message) {
    child.stdin.write(`${JSON.stringify({ id: message.id, error: { code: -32601, message: 'Método não suportado pelo smoke.' } })}\n`)
  }
}

function observeScenario(message) {
  const serialized = JSON.stringify(message)
  if (scenario === 'build-external') {
    if (mentionsPath(serialized, externalFile) || serialized.includes(path.basename(externalFile))) {
      report.externalPathAttemptObserved = true
    }
    if (/blocked|denied|outside|not permitted|permission|sandbox|recus/i.test(serialized)) {
      report.externalPathBlockedObserved = true
    }
  }
  if (scenario === 'build-network') {
    if (/127\.0\.0\.1:9|curl|network|requisi[cç][aã]o HTTP/i.test(serialized)) report.networkAttemptObserved = true
    if (/blocked|denied|not permitted|network is unreachable|operation not permitted|recus/i.test(serialized)) {
      report.networkAccessBlockedObserved = true
    }
  }
}

function handleApproval(message) {
  const params = message.params && typeof message.params === 'object' ? message.params : {}
  report.approvalsObserved += 1
  let accepted = false

  if (scenario === 'build-write' && canApproveBuildWrite(message.method, params)) {
    accepted = true
    report.buildApprovalObserved += 1
    report.buildApprovalAccepted += 1
  } else if (scenario === 'build-write') {
    report.buildApprovalObserved += 1
  }

  if (scenario === 'build-external') {
    report.externalPathAttemptObserved = report.externalPathAttemptObserved || mentionsExternalPath(params)
    if (report.externalPathAttemptObserved) report.externalPathApprovalDeclined = true
  }
  if (scenario === 'build-network') {
    report.networkApprovalObserved += 1
    report.networkAttemptObserved = true
  }
  if (scenario === 'build-cancel' && canApproveCancellation(message.method, params)) accepted = true

  if (message.method === 'item/permissions/requestApproval') {
    sendPermissionResponse(message, accepted)
    return
  }
  child.stdin.write(`${JSON.stringify({ id: message.id, result: { decision: accepted ? 'accept' : 'decline' } })}\n`)
  if (!accepted) report.approvalsDeclined += 1
  if (scenario === 'build-network' && !accepted) report.networkApprovalDeclined += 1
}

function sendPermissionResponse(message, accepted) {
  const permissions = accepted
    ? { fileSystem: { read: [], write: [root] }, network: { enabled: false } }
    : { fileSystem: { read: [], write: [] }, network: { enabled: false } }
  child.stdin.write(`${JSON.stringify({
    id: message.id,
    result: { permissions, scope: 'turn', strictAutoReview: true },
  })}\n`)
  if (!accepted) report.approvalsDeclined += 1
  if (scenario === 'build-network') report.networkApprovalDeclined += 1
}

function canApproveBuildWrite(method, params) {
  if (mentionsExternalPath(params) || /network|curl|https?:\/\//i.test(JSON.stringify(params))) return false
  if (params.grantRoot && !isPathInside(params.grantRoot, root)) return false
  if (method === 'item/fileChange/requestApproval' || method === 'item/permissions/requestApproval') {
    return !/"kind"\s*:\s*"root"/i.test(JSON.stringify(params.permissions ?? params))
  }
  return method === 'item/commandExecution/requestApproval'
    && (mentionsPath(JSON.stringify(params), buildFile) || JSON.stringify(params).includes(path.basename(buildFile)))
}

function canApproveCancellation(method, params) {
  if (method !== 'item/commandExecution/requestApproval') return false
  const serialized = JSON.stringify(params)
  return /sleep|setTimeout|timeout/i.test(serialized) && !/network|https?:\/\/|127\.0\.0\.1/i.test(serialized)
}

function mentionsExternalPath(value) {
  const serialized = JSON.stringify(value)
  return mentionsPath(serialized, externalFile) || serialized.includes(path.basename(externalFile))
}

function mentionsPath(serialized, target) {
  if (!target) return false
  return [target, target.replaceAll('\\', '/'), target.replaceAll('\\', '\\\\')]
    .some((candidate) => serialized.includes(candidate))
}

function isPathInside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
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

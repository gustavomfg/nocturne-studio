import { app } from 'electron'
import { AppImageUpdater, MacUpdater, NsisUpdater } from 'electron-updater'
import { CancellationToken } from 'builder-util-runtime'
import { extractFile } from '@electron/asar'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { resolveBaseVersion, validateRehearsalVersions } from './updater-rehearsal-contract.mjs'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { load: parseYaml } = require('js-yaml')
const root = process.cwd()
const packageMetadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const stableVersion = process.env.UPDATER_REHEARSAL_VERSION || packageMetadata.version
const basePackagePath = process.env.UPDATER_REHEARSAL_BASE_PACKAGE || ''
const explicitBaseVersion = process.env.UPDATER_REHEARSAL_BASE_VERSION || ''
const reportPath = path.resolve(process.env.UPDATER_REHEARSAL_REPORT || path.join('test-results', 'updater-rehearsal.json'))
const startupTimeoutMs = 120_000
const downloadChunkDelayMs = 5

let fixtureRoot
let processUserData
let cacheRoot
let targetUserData
const report = {
  ok: false,
  platform: process.platform,
  architecture: process.arch,
  currentVersion: packageMetadata.version,
  baseVersion: '',
  candidateVersion: stableVersion,
  baseCommit: process.env.UPDATER_REHEARSAL_BASE_COMMIT || '',
  stableVersion,
  releaseType: 'release',
  currentAppVersion: '',
  candidateAppVersion: '',
  allowPrerelease: false,
  channel: '',
  stableChannelValidated: false,
  metadataFile: '',
  metadataSource: '',
  metadataTag: `v${stableVersion}`,
  artifact: '',
  artifactSize: 0,
  artifactSha512: '',
  downloadIntegrityVerified: false,
  updateDetected: false,
  interruptedDownload: false,
  retrySucceeded: false,
  progressEvents: 0,
  artifactRequests: 0,
  downloadedPath: '',
  baseStartup: null,
  candidateStartup: null,
  binaryInstallation: {
    performed: false,
    mode: 'unpacked-candidate-first-startup',
    note: 'The real updater download is exercised; replacing the running installation is intentionally not performed in CI.',
  },
  preservedData: null,
  credentialsCopied: false,
  logs: [],
}

let server
let updater
let previousAppImage

async function main() {
  app.disableHardwareAcceleration()
  fixtureRoot = await fsp.mkdtemp(path.join(require('node:os').tmpdir(), 'nocturne-updater-rehearsal-'))
  processUserData = path.join(fixtureRoot, 'updater-process-user-data')
  cacheRoot = path.join(fixtureRoot, 'updater-cache')
  targetUserData = path.join(fixtureRoot, 'target-user-data')
  app.setPath('userData', processUserData)
  await fsp.mkdir(processUserData, { recursive: true })
  await fsp.mkdir(cacheRoot, { recursive: true })
  await fsp.mkdir(targetUserData, { recursive: true })

  try {
  const paths = await resolveRehearsalPaths()
  report.artifact = paths.artifact
  report.metadataFile = paths.metadataFile
  report.currentAppVersion = readAsarVersion(paths.baseApp)
  report.candidateAppVersion = readAsarVersion(paths.candidateApp)
  const baseVersion = resolveBaseVersion({ packagePath: basePackagePath, explicitVersion: explicitBaseVersion })
  const versions = validateRehearsalVersions({
    baseVersion,
    baseArtifactVersion: report.currentAppVersion,
    candidateVersion: stableVersion,
    candidatePackageVersion: packageMetadata.version,
    candidateArtifactVersion: report.candidateAppVersion,
  })
  report.baseVersion = versions.baseVersion
  report.candidateVersion = versions.candidateVersion

  const baseResult = await launchPackagedApp(paths.baseApp, 'base')
  report.baseStartup = baseResult.report
  const before = snapshotUserData()
  if (!before.messages.some((message) => message.content === 'package-smoke')) {
    throw new Error('O fixture base não contém a mensagem sintética esperada.')
  }

  const artifactInfo = await describeArtifact(paths.artifact)
  report.artifactSize = artifactInfo.size
  report.artifactSha512 = artifactInfo.sha512
  if (artifactInfo.size < 1_000_000) {
    throw new Error('O artefato candidato é pequeno demais para provar interrupção de download de forma determinística.')
  }

  server = await startFixtureServer(paths, artifactInfo)
  report.metadataSource = server.state.metadataSource
  const configPath = await writeUpdaterConfig(server.baseUrl)
  await app.whenReady()
  if (process.platform === 'linux') {
    previousAppImage = process.env.APPIMAGE
    const baseArtifact = paths.baseArtifact
    if (!baseArtifact) throw new Error('O artefato AppImage base não foi encontrado.')
    const oldAppImage = path.join(fixtureRoot, 'current.AppImage')
    await fsp.copyFile(baseArtifact, oldAppImage)
    process.env.APPIMAGE = oldAppImage
  }
  updater = createUpdater(configPath, server.baseUrl, report.currentAppVersion)
  const check = await updater.checkForUpdates()
  report.allowPrerelease = updater.allowPrerelease
  report.channel = updater.channel || ''
  report.updateDetected = Boolean(check?.isUpdateAvailable && check.updateInfo?.version === stableVersion)
  if (!report.updateDetected) {
    throw new Error(`O updater não detectou a release stable ${stableVersion}: ${JSON.stringify(check?.updateInfo ?? null)}`)
  }
  if (!report.allowPrerelease) {
    throw new Error('A instalação beta não ativou allowPrerelease conforme o contrato do electron-updater.')
  }
  const stableProbe = createUpdater(configPath, server.baseUrl, stableVersion)
  try {
    const stableCheck = await stableProbe.checkForUpdates()
    if (stableProbe.allowPrerelease || stableCheck?.isUpdateAvailable || stableCheck?.updateInfo?.version !== stableVersion) {
      throw new Error(`A política stable retornou um resultado inesperado: ${JSON.stringify(stableCheck?.updateInfo ?? null)}`)
    }
    report.stableChannelValidated = true
  } finally {
    disposeUpdaterInstance(stableProbe)
  }

  await exerciseInterruptedDownload(updater, artifactInfo)
  report.artifactRequests = server.state.artifactRequests
  const downloadedPath = updater.downloadedUpdateHelper?.file
  if (!downloadedPath || !(await pathExists(downloadedPath))) {
    throw new Error('O updater não expôs um artefato baixado após o retry.')
  }
  report.downloadedPath = downloadedPath
  if (await hashFile(downloadedPath) !== artifactInfo.sha512) {
    throw new Error('O SHA-512 do artefato baixado não corresponde ao metadata.')
  }
  report.downloadIntegrityVerified = true
  report.retrySucceeded = true

  await disposeUpdater()
  const candidateResult = await launchPackagedApp(paths.candidateApp, 'candidate')
  report.candidateStartup = candidateResult.report
  const after = snapshotUserData()
  report.preservedData = comparePreservedData(before, after)
  if (!report.preservedData.ok) throw new Error(report.preservedData.reason)
  report.credentialsCopied = await hasCredentialFiles(targetUserData)
  if (report.credentialsCopied) throw new Error('O rehearsal encontrou arquivo de credencial no userData transferido.')

  report.ok = true
  await writeReport()
  process.stdout.write(`Updater rehearsal concluído: ${JSON.stringify(summarizeReport())}\n`)
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error)
  await writeReport()
  process.stderr.write(`Updater rehearsal falhou: ${report.failure}\n`)
} finally {
  await disposeUpdater()
  if (server) await closeServer(server.server)
  if (previousAppImage === undefined) delete process.env.APPIMAGE
  else process.env.APPIMAGE = previousAppImage
  await fsp.rm(fixtureRoot, { recursive: true, force: true }).catch(() => undefined)
    app.exit(report.ok ? 0 : 1)
  }
}

void main().catch((error) => {
  report.failure = error instanceof Error ? error.message : String(error)
  void writeReport()
    .catch(() => undefined)
    .finally(() => app.exit(1))
})

async function resolveRehearsalPaths() {
  const currentRelease = path.resolve(process.env.UPDATER_REHEARSAL_BASE_RELEASE || path.join(root, 'release', packageMetadata.version))
  const candidateRelease = path.resolve(process.env.UPDATER_REHEARSAL_CANDIDATE_RELEASE || path.join(root, `release/rehearsal-${stableVersion}`))
  const baseApp = path.resolve(process.env.UPDATER_REHEARSAL_BASE_APP || await findExecutable(currentRelease))
  const candidateApp = path.resolve(process.env.UPDATER_REHEARSAL_CANDIDATE_APP || await findExecutable(candidateRelease))
  const artifact = path.resolve(process.env.UPDATER_REHEARSAL_ARTIFACT || await findArtifact(candidateRelease))
  const baseArtifact = process.platform === 'linux' ? await findArtifact(currentRelease, '.AppImage') : null
  return {
    baseApp,
    candidateApp,
    artifact,
    baseArtifact,
    metadataFile: metadataFileForPlatform(),
    metadataPath: path.resolve(process.env.UPDATER_REHEARSAL_METADATA || path.join(path.dirname(artifact), metadataFileForPlatform())),
  }
}

async function findExecutable(directory) {
  const candidates = process.platform === 'linux'
    ? [path.join(directory, 'linux-unpacked', 'nocturne-studio')]
    : process.platform === 'win32'
      ? [path.join(directory, 'win-unpacked', 'Nocturne Studio.exe')]
      : [
          path.join(directory, 'mac', 'Nocturne Studio.app', 'Contents', 'MacOS', 'Nocturne Studio'),
          path.join(directory, 'mac-arm64', 'Nocturne Studio.app', 'Contents', 'MacOS', 'Nocturne Studio'),
          path.join(directory, 'mac-x64', 'Nocturne Studio.app', 'Contents', 'MacOS', 'Nocturne Studio'),
        ]
  for (const candidate of candidates) if (await pathExists(candidate)) return candidate
  throw new Error(`Executável empacotado não encontrado em ${directory}. Execute o build base e o build candidato primeiro.`)
}

async function findArtifact(directory, expectedExtension = platformArtifactExtension()) {
  const entries = await fsp.readdir(directory, { withFileTypes: true }).catch(() => [])
  const candidate = entries.find((entry) => entry.isFile() && entry.name.endsWith(expectedExtension) && !entry.name.endsWith('.blockmap'))
  if (!candidate) throw new Error(`Artefato ${expectedExtension} não encontrado em ${directory}.`)
  return path.join(directory, candidate.name)
}

function platformArtifactExtension() {
  if (process.platform === 'linux') return '.AppImage'
  if (process.platform === 'win32') return '.exe'
  return '.zip'
}

function metadataFileForPlatform() {
  if (process.platform === 'linux') return 'latest-linux.yml'
  if (process.platform === 'win32') return 'latest.yml'
  return 'latest-mac.yml'
}

function readAsarVersion(executable) {
  const asarPath = findAsarPath(executable)
  const packageJson = JSON.parse(extractFile(asarPath, 'package.json').toString('utf8'))
  return String(packageJson.version)
}

function findAsarPath(executable) {
  let current = path.dirname(executable)
  for (let index = 0; index < 6; index += 1) {
    const candidate = path.join(current, 'resources', 'app.asar')
    if (fs.existsSync(candidate)) return candidate
    current = path.dirname(current)
  }
  throw new Error(`app.asar não encontrado para ${executable}`)
}

async function describeArtifact(filePath) {
  const stat = await fsp.stat(filePath)
  return { size: stat.size, sha512: await hashFile(filePath) }
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    const stream = fs.createReadStream(filePath)
    stream.on('error', reject)
    hash.on('error', reject)
    hash.on('finish', () => resolve(hash.read().toString('base64')))
    stream.pipe(hash)
  })
}

async function startFixtureServer(paths, artifactInfo) {
  const metadata = await loadCandidateMetadata(paths, artifactInfo)
  const serverState = { artifactRequests: 0, metadataText: metadata.text, metadataSource: metadata.source }
  const server = createServer((request, response) => {
    void handleFixtureRequest(request, response, paths, artifactInfo, serverState).catch((error) => {
      if (!response.headersSent) response.writeHead(500)
      response.end(String(error instanceof Error ? error.message : error))
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Servidor local do rehearsal não expôs uma porta.')
  return { server, state: serverState, baseUrl: `http://127.0.0.1:${address.port}` }
}

async function loadCandidateMetadata(paths, artifactInfo) {
  if (await pathExists(paths.metadataPath)) {
    const text = await fsp.readFile(paths.metadataPath, 'utf8')
    const parsed = parseYaml(text)
    const selectedFile = Array.isArray(parsed?.files) ? parsed.files.find((file) => path.basename(String(file?.url || file?.path || '')) === path.basename(paths.artifact)) : null
    if (String(parsed?.version) !== stableVersion || selectedFile?.sha512 !== artifactInfo.sha512) {
      throw new Error(`Metadata ${paths.metadataPath} não representa o artefato candidato ${stableVersion}.`)
    }
    return { text, source: 'electron-builder-output' }
  }
  if (process.env.CI) {
    throw new Error(`Metadata gerado pelo electron-builder não encontrado em ${paths.metadataPath}. O CI não usa metadata sintético.`)
  }
  const text = [
    `version: ${stableVersion}`,
    'files:',
    `  - url: ${path.basename(paths.artifact)}`,
    `    sha512: ${artifactInfo.sha512}`,
    `    size: ${artifactInfo.size}`,
    `path: ${path.basename(paths.artifact)}`,
    `sha512: ${artifactInfo.sha512}`,
    'releaseDate: 2026-08-20T00:00:00.000Z',
    'releaseNotes: "Updater rehearsal fixture"',
    '',
  ].join('\n')
  return { text, source: 'generated-compatible-fallback' }
}

async function handleFixtureRequest(request, response, paths, artifactInfo, state) {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1')
  const basePath = '/fixture/rehearsal/releases'
  if (requestUrl.pathname === `${basePath}.atom`) {
    const href = `${request.headers.host ? `http://${request.headers.host}` : 'http://127.0.0.1'}${basePath}/tag/v${stableVersion}`
    const data = Buffer.from(`<?xml version="1.0"?><feed><entry><link href="${href}" /></entry></feed>`)
    response.writeHead(200, { 'Content-Type': 'application/atom+xml', 'Content-Length': data.length, 'Cache-Control': 'no-store' })
    response.end(data)
    return
  }
  if (
    requestUrl.pathname === `${basePath}/latest`
    || requestUrl.pathname === '/api/v3/repos/fixture/rehearsal/releases/latest'
  ) {
    const data = Buffer.from(JSON.stringify({ tag_name: `v${stableVersion}` }))
    response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': data.length, 'Cache-Control': 'no-store' })
    response.end(data)
    return
  }
  const metadataPath = `${basePath}/download/v${stableVersion}/${paths.metadataFile}`
  if (requestUrl.pathname === metadataPath) {
    const data = Buffer.from(state.metadataText)
    response.writeHead(200, { 'Content-Type': 'text/yaml', 'Content-Length': data.length, 'Cache-Control': 'no-store' })
    response.end(data)
    return
  }
  const artifactPath = `${basePath}/download/v${stableVersion}/${encodeURIComponent(path.basename(paths.artifact))}`
  if (requestUrl.pathname === artifactPath || decodeURIComponent(requestUrl.pathname) === `${basePath}/download/v${stableVersion}/${path.basename(paths.artifact)}`) {
    state.artifactRequests += 1
    await streamArtifact(paths.artifact, response, request)
    return
  }
  response.writeHead(404)
  response.end()
}

async function streamArtifact(filePath, response, request) {
  const stat = await fsp.stat(filePath)
  response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-store' })
  const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 })
  let closed = false
  const stop = () => {
    closed = true
    stream.destroy()
  }
  request.once('close', stop)
  response.once('close', stop)
  stream.on('error', (error) => {
    if (!closed) response.destroy(error)
  })
  stream.on('data', (chunk) => {
    stream.pause()
    if (closed || response.destroyed) return
    response.write(chunk)
    setTimeout(() => { if (!closed) stream.resume() }, downloadChunkDelayMs)
  })
  await new Promise((resolve) => {
    stream.once('end', resolve)
    stream.once('close', resolve)
  })
  if (!closed) response.end()
}

async function writeUpdaterConfig(baseUrl) {
  const configPath = path.join(fixtureRoot, 'app-update.yml')
  const config = [
    'provider: github',
    'owner: fixture',
    'repo: rehearsal',
    'protocol: http',
    `host: ${new URL(baseUrl).host}`,
    'updaterCacheDirName: nocturne-updater-rehearsal',
    'releaseType: release',
    '',
  ].join('\n')
  await fsp.writeFile(configPath, config, { encoding: 'utf8', mode: 0o600 })
  return configPath
}

function createUpdater(configPath, baseUrl, versionOverride) {
  const updater = process.platform === 'linux'
    ? new AppImageUpdater()
    : process.platform === 'win32'
      ? new NsisUpdater()
      : new MacUpdater()
  updater.updateConfigPath = configPath
  updater.setFeedURL({ provider: 'github', owner: 'fixture', repo: 'rehearsal', protocol: 'http', host: new URL(baseUrl).host })
  updater.forceDevUpdateConfig = true
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.disableDifferentialDownload = true
  // The harness itself runs under the development Electron binary.  Override
  // only the adapter's identity so the real updater evaluates the packaged
  // 0.9.5-beta fixture, rather than Electron's own version (43.1.1).
  const baseVersion = new updater.currentVersion.constructor(versionOverride)
  Object.defineProperty(updater.app, 'version', { configurable: true, value: versionOverride })
  updater.currentVersion = baseVersion
  updater.allowPrerelease = baseVersion.prerelease.length > 0
  Object.defineProperty(updater.app, 'baseCachePath', { configurable: true, value: cacheRoot })
  updater.logger = {
    debug: (message) => report.logs.push(`debug:${String(message).slice(0, 500)}`),
    info: (message) => report.logs.push(`info:${String(message).slice(0, 500)}`),
    warn: (message) => report.logs.push(`warn:${String(message).slice(0, 500)}`),
    error: (message) => report.logs.push(`error:${String(message).slice(0, 500)}`),
  }
  return updater
}

async function exerciseInterruptedDownload(currentUpdater, artifactInfo) {
  const token = new CancellationToken()
  const threshold = Math.max(256 * 1024, Math.floor(artifactInfo.size * 0.02))
  let cancelled = false
  const onProgress = (progress) => {
    report.progressEvents += 1
    if (!cancelled && progress.transferred >= threshold) {
      cancelled = true
      token.cancel()
    }
  }
  currentUpdater.on('download-progress', onProgress)
  try {
    await currentUpdater.downloadUpdate(token)
  } catch (error) {
    if (!cancelled || !String(error?.message || error).toLowerCase().includes('cancel')) throw error
    report.interruptedDownload = true
  } finally {
    currentUpdater.removeListener('download-progress', onProgress)
  }
  if (!report.interruptedDownload) throw new Error('O download terminou antes de a interrupção controlada ser observada.')
  const files = await currentUpdater.downloadUpdate()
  if (!files.length && !currentUpdater.downloadedUpdateHelper?.file) throw new Error('O retry não retornou nem registrou o artefato baixado.')
}

async function launchPackagedApp(executable, label) {
  const output = path.join(fixtureRoot, `${label}-package-smoke.json`)
  const args = [`--user-data-dir=${targetUserData}`, '--disable-gpu']
  if (process.platform === 'linux' && process.env.CI) args.push('--no-sandbox')
  const childEnv = { ...process.env, NOCTURNE_PACKAGE_SMOKE_OUTPUT: output, ELECTRON_ENABLE_LOGGING: '1' }
  delete childEnv.APPIMAGE
  const result = await runChild(executable, args, childEnv, label)
  if (result.code !== 0) throw new Error(`${label} encerrou com código ${result.code}: ${result.stderr.slice(-4_000)}`)
  if (!(await pathExists(output))) throw new Error(`${label} não produziu o relatório do package smoke.`)
  const smoke = JSON.parse(await fsp.readFile(output, 'utf8'))
  if (!smoke.ok || !smoke.packaged) throw new Error(`${label} package smoke inválido: ${JSON.stringify(smoke)}`)
  return { report: smoke, stderr: result.stderr.slice(-4_000) }
}

function runChild(command, args, env, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${label} não encerrou em ${startupTimeoutMs}ms.`))
    }, startupTimeoutMs)
    child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-16_000) })
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_000) })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }) })
  })
}

function snapshotUserData() {
  const databasePath = path.join(targetUserData, 'nocturne.db')
  const database = new Database(databasePath, { readonly: true })
  try {
    return {
      conversations: database.prepare('SELECT id,title,workspace FROM conversations ORDER BY id').all(),
      messages: database.prepare('SELECT id,conversation_id,content FROM messages ORDER BY id').all(),
      workspaces: database.prepare('SELECT path,name,authorized FROM workspaces ORDER BY path').all(),
      settings: database.prepare('SELECT key,value FROM settings ORDER BY key').all(),
    }
  } finally {
    database.close()
  }
}

function comparePreservedData(before, after) {
  const beforeMessageIds = new Set(before.messages.map((message) => message.id))
  const afterMessages = new Map(after.messages.map((message) => [message.id, message]))
  const missingMessage = before.messages.find((message) => !afterMessages.has(message.id) || afterMessages.get(message.id).content !== message.content)
  const missingConversation = before.conversations.find((conversation) => !after.conversations.some((candidate) => candidate.id === conversation.id && candidate.workspace === conversation.workspace))
  const missingWorkspace = before.workspaces.find((workspace) => !after.workspaces.some((candidate) => candidate.path === workspace.path && candidate.name === workspace.name))
  return {
    ok: !missingMessage && !missingConversation && !missingWorkspace,
    preservedMessages: beforeMessageIds.size,
    preservedConversations: before.conversations.length,
    preservedWorkspaces: before.workspaces.length,
    reason: missingMessage
      ? `Mensagem ${missingMessage.id} não foi preservada.`
      : missingConversation
        ? `Conversa ${missingConversation.id} não foi preservada.`
        : missingWorkspace
          ? `Workspace ${missingWorkspace.path} não foi preservado.`
          : '',
  }
}

async function hasCredentialFiles(directory) {
  const names = ['provider-credentials.json', '.provider-credentials.json', 'credentials.json']
  for (const name of names) if (await pathExists(path.join(directory, name))) return true
  return false
}

async function disposeUpdater() {
  if (!updater) return
  disposeUpdaterInstance(updater)
  updater = null
}

function disposeUpdaterInstance(currentUpdater) {
  try {
    currentUpdater.removeAllListeners()
    currentUpdater.closeServerIfExists?.()
  } catch { /* diagnostic harness cleanup is best effort */ }
}

function closeServer(serverToClose) {
  return new Promise((resolve) => serverToClose.close(() => resolve()))
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath)
    return true
  } catch {
    return false
  }
}

async function writeReport() {
  await fsp.mkdir(path.dirname(reportPath), { recursive: true })
  await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

function summarizeReport() {
  return {
    ok: report.ok,
    platform: report.platform,
    currentVersion: report.currentAppVersion,
    candidateVersion: report.candidateAppVersion,
    detected: report.updateDetected,
    interrupted: report.interruptedDownload,
    retry: report.retrySucceeded,
    preserved: report.preservedData?.ok === true,
    report: reportPath,
  }
}

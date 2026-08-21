import { createRequire } from 'node:module'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electron = require('electron')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageMetadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const reportArgumentIndex = process.argv.indexOf('--report')
const reportPath = path.resolve(process.env.PACKAGED_RECOVERY_REPORT || (reportArgumentIndex >= 0 ? process.argv[reportArgumentIndex + 1] : '') || path.join('test-results', 'packaged-recovery.json'))
const manualRecovery = process.argv.includes('--manual-valid-recovery')
const historicalBaseline = 'f793b9cd2e3dd03d1df7ba79da56007400a60e8f'
const expectedSha = process.env.PACKAGED_RECOVERY_EXPECTED_SHA || ''
const report = {
  schema: 1,
  sha: safeGit(['rev-parse', 'HEAD']),
  version: packageMetadata.version,
  historicalBaseline: { commit: historicalBaseline, version: '0.9.5-beta', schemaVersion: 15 },
  platform: process.platform,
  architecture: process.arch,
  isolatedUserData: false,
  normalRestart: false,
  corruptionDetected: false,
  validRecoveryRestored: false,
  corruptOriginalPreserved: false,
  invalidCandidateRejected: false,
  interruptedRestoreSafe: { packaged: false, unitEvidence: true },
  recoveryTemporaryArtifactHandled: false,
  recoveryEngineAutomated: false,
  nativeRecoveryConsentConfirmed: false,
  migrationBackupValid: null,
  migrationPreservedData: null,
  migrationApplied: null,
  historicalStartup: false,
  postRecoveryRestart: false,
  workspaceHistoryPreserved: false,
  workspaceAuthorizationRefusedWhenMissing: false,
  credentialsExported: false,
  integrity: 'unknown',
  manualRecoveryRequired: true,
  diagnostics: {
    currentStage: 'bootstrap',
    currentScenario: 'bootstrap',
    executable: null,
    processes: [],
    partialReports: [],
  },
  timingsMs: {},
  failure: null,
}

let temporaryRoot = ''

try {
  setDiagnosticStage('bootstrap', 'bootstrap')
  const executable = packagedExecutable()
  report.diagnostics.executable = path.basename(executable)
  if (expectedSha && report.sha !== expectedSha) throw new Error('O SHA do checkout não corresponde ao SHA esperado pelo rehearsal.')
  setDiagnosticStage('validate-environment', 'bootstrap')
  temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'nocturne-packaged-recovery-'))
  const userData = path.join(temporaryRoot, 'user-data')
  const workspace = path.join(temporaryRoot, 'workspace-a')
  setDiagnosticStage('validate-user-data', 'bootstrap')
  await fsp.mkdir(userData, { recursive: true, mode: 0o700 })
  await fsp.mkdir(workspace, { recursive: true, mode: 0o700 })
  assertIsolatedUserData(temporaryRoot, userData)
  report.isolatedUserData = true

  const baseReport = path.join(temporaryRoot, 'fixture.json')
  setDiagnosticStage('prepare-fixture', 'fixture')
  const fixtureStart = Date.now()
  const fixture = await launch(executable, userData, workspace, 'fixture', baseReport, { scenario: 'fixture' })
  report.timingsMs.fixtureStartup = Date.now() - fixtureStart
  assertSuccessfulFixture(fixture)
  setDiagnosticStage('open-database', 'fixture')
  const baselineDatabase = path.join(userData, 'nocturne.db')
  if (!fs.existsSync(baselineDatabase)) throw new Error('O fixture empacotado não produziu o banco esperado.')
  setDiagnosticStage('write-report', 'fixture')
  const baselineState = await readReport(baseReport)
  if (!baselineState.ok || !allMarkers(baselineState.state?.markers)) throw new Error('O fixture empacotado não contém todos os marcadores semânticos.')

  const restartReport = path.join(temporaryRoot, 'restart.json')
  setDiagnosticStage('prepare-fixture', 'normal-restart')
  const restartStart = Date.now()
  const restart = await launch(executable, userData, workspace, 'verify', restartReport, { scenario: 'normal-restart' })
  report.timingsMs.normalRestart = Date.now() - restartStart
  setDiagnosticStage('write-report', 'normal-restart')
  const restarted = await readReport(restartReport)
  report.normalRestart = restart.code === 0 && restarted.ok === true && allMarkers(restarted.state?.markers)
  if (!report.normalRestart) throw new Error('O restart normal empacotado não preservou o fixture.')
  report.workspaceHistoryPreserved = true

  const noCandidate = await cloneScenario(temporaryRoot, 'no-candidate', userData, workspace)
  setDiagnosticStage('prepare-fixture', 'corruption-no-candidate')
  corruptDatabase(noCandidate.userData)
  const noCandidateResult = await launch(executable, noCandidate.userData, noCandidate.workspace, 'verify', noCandidate.report, { harnessRoot: temporaryRoot, scenario: 'corruption-no-candidate' })
  setDiagnosticStage('write-report', 'corruption-no-candidate')
  const noCandidateFailure = await readReport(noCandidate.report)
  report.corruptionDetected = noCandidateResult.code !== 0 && noCandidateFailure.phase === 'startup-failure'
  report.corruptOriginalPreserved = isCorruptDatabase(noCandidate.database)
  if (!report.corruptionDetected || !report.corruptOriginalPreserved) throw new Error('O startup empacotado não preservou um banco corrompido sem candidato.')

  const invalidCandidate = await cloneScenario(temporaryRoot, 'invalid-candidate', userData, workspace)
  setDiagnosticStage('prepare-fixture', 'invalid-candidate')
  corruptDatabase(invalidCandidate.userData)
  await fsp.copyFile(invalidCandidate.database, path.join(invalidCandidate.userData, 'nocturne.db.recovery-invalid'))
  const invalidResult = await launch(executable, invalidCandidate.userData, invalidCandidate.workspace, 'verify', invalidCandidate.report, { harnessRoot: temporaryRoot, scenario: 'invalid-candidate' })
  setDiagnosticStage('write-report', 'invalid-candidate')
  const invalidFailure = await readReport(invalidCandidate.report)
  report.invalidCandidateRejected = invalidResult.code !== 0 && invalidFailure.phase === 'startup-failure' && isCorruptDatabase(invalidCandidate.database) && fs.existsSync(path.join(invalidCandidate.userData, 'nocturne.db.recovery-invalid'))
  if (!report.invalidCandidateRejected) throw new Error('Um candidato de recovery inválido não foi rejeitado de forma controlada.')

  const interruptedArtifact = await cloneScenario(temporaryRoot, 'interrupted-artifact', userData, workspace)
  setDiagnosticStage('prepare-fixture', 'interrupted-artifact')
  corruptDatabase(interruptedArtifact.userData)
  await fsp.writeFile(path.join(interruptedArtifact.userData, 'nocturne.db.recovery-interrupted'), Buffer.from('partial recovery copy'))
  const interruptedResult = await launch(executable, interruptedArtifact.userData, interruptedArtifact.workspace, 'verify', interruptedArtifact.report, { harnessRoot: temporaryRoot, scenario: 'interrupted-artifact' })
  setDiagnosticStage('write-report', 'interrupted-artifact')
  const interruptedFailure = await readReport(interruptedArtifact.report)
  report.recoveryTemporaryArtifactHandled = interruptedResult.code !== 0 && interruptedFailure.phase === 'startup-failure' && fs.existsSync(path.join(interruptedArtifact.userData, 'nocturne.db.recovery-interrupted')) && isCorruptDatabase(interruptedArtifact.database)
  if (!report.recoveryTemporaryArtifactHandled) throw new Error('Um artefato temporário inválido não foi preservado durante o startup empacotado.')

  const engine = await cloneScenario(temporaryRoot, 'engine-recovery', userData, workspace)
  setDiagnosticStage('prepare-fixture', 'engine-recovery')
  await fsp.copyFile(baselineDatabase, path.join(engine.userData, 'nocturne.db.recovery-engine'))
  const engineReport = path.join(engine.scenario, 'result.json')
  const engineResult = await launch(executable, engine.userData, engine.workspace, 'engine-restore', engineReport, { harnessRoot: temporaryRoot, scenario: 'engine-recovery' })
  setDiagnosticStage('write-report', 'engine-recovery')
  const engineState = await readReport(engineReport)
  report.recoveryEngineAutomated = engineResult.code === 0 && engineState.ok === true && engineState.recoveryEngine?.restored === true && engineState.recoveryEngine?.corruptOriginalPreserved === true && allMarkers(engineState.state?.markers)
  report.validRecoveryRestored = report.recoveryEngineAutomated
  report.postRecoveryRestart = report.recoveryEngineAutomated ? await verifyPostRecoveryRestart(executable, engine.userData, engine.workspace, temporaryRoot) : false
  if (!report.recoveryEngineAutomated || !report.postRecoveryRestart) throw new Error('O engine de recovery empacotado não restaurou o candidato válido ou não passou no restart.')

  const moved = await cloneScenario(temporaryRoot, 'moved-workspace', userData, workspace)
  setDiagnosticStage('prepare-fixture', 'moved-workspace')
  const movedWorkspace = path.join(temporaryRoot, 'workspace-b')
  await fsp.rename(moved.workspace, movedWorkspace)
  const movedReport = path.join(temporaryRoot, 'moved.json')
  const movedResult = await launch(executable, moved.userData, moved.workspace, 'verify', movedReport, { harnessRoot: temporaryRoot, scenario: 'moved-workspace' })
  setDiagnosticStage('write-report', 'moved-workspace')
  const movedState = await readReport(movedReport)
  report.workspaceHistoryPreserved = movedResult.code === 0 && movedState.ok === true && allMarkers(movedState.state?.markers)
  report.workspaceAuthorizationRefusedWhenMissing = movedState.state?.workspace?.authorizationRefusedWhenMissing === true
  if (!report.workspaceHistoryPreserved || !report.workspaceAuthorizationRefusedWhenMissing) throw new Error('O workspace movido não preservou o histórico ou não perdeu autorização até a reseleção.')
  await fsp.rename(movedWorkspace, workspace)

  setDiagnosticStage('prepare-fixture', 'historical-startup')
  const historical = await runHistoricalStartup(executable, temporaryRoot)
  setDiagnosticStage('write-report', 'historical-startup')
  report.historicalStartup = historical.ok
  report.migrationApplied = historical.migrationApplied
  report.migrationPreservedData = historical.preservedData
  report.migrationBackupValid = historical.migrationBackupValid
  if (!report.historicalStartup || !report.migrationPreservedData) throw new Error('O startup empacotado não abriu o fixture histórico 0.9.5-beta.')

  if (manualRecovery) {
    const valid = await cloneScenario(temporaryRoot, 'valid-recovery', userData, workspace)
    setDiagnosticStage('prepare-fixture', 'manual-valid-recovery')
    corruptDatabase(valid.userData)
    await fsp.copyFile(baselineDatabase, path.join(valid.userData, 'nocturne.db.recovery-valid'))
    process.stdout.write('Confirme “Restaurar ponto de recuperação” no diálogo nativo do Nocturne Studio para concluir a etapa manual.\n')
    const validResult = await launch(executable, valid.userData, valid.workspace, 'verify', valid.report, { timeoutMs: 120_000, harnessRoot: temporaryRoot, scenario: 'manual-valid-recovery' })
    setDiagnosticStage('write-report', 'manual-valid-recovery')
    const validState = await readReport(valid.report)
    report.nativeRecoveryConsentConfirmed = validResult.code === 0 && validState.ok === true && allMarkers(validState.state?.markers) && hasQuarantine(valid.userData)
    report.validRecoveryRestored = report.nativeRecoveryConsentConfirmed
    report.postRecoveryRestart = report.nativeRecoveryConsentConfirmed ? await verifyPostRecoveryRestart(executable, valid.userData, valid.workspace, temporaryRoot) : false
    report.manualRecoveryRequired = !report.nativeRecoveryConsentConfirmed
    if (!report.nativeRecoveryConsentConfirmed || !report.postRecoveryRestart) throw new Error('A confirmação nativa de recovery não produziu um restart semântico válido.')
  }

  report.integrity = report.normalRestart && report.corruptionDetected && report.corruptOriginalPreserved && report.invalidCandidateRejected && report.recoveryTemporaryArtifactHandled && report.recoveryEngineAutomated && report.historicalStartup ? 'ok' : 'partial'
  setDiagnosticStage('shutdown', 'complete')
  await writeReport()
  process.stdout.write(`Packaged recovery rehearsal concluído: ${JSON.stringify(summarize())}\n`)
} catch (error) {
  report.integrity = 'failed'
  report.failure = 'packaged-recovery-failed'
  report.diagnostics.failure = sanitizeError(error)
  await writeReport().catch(() => undefined)
  process.stderr.write(`Packaged recovery rehearsal falhou: ${sanitizeDiagnosticText(error instanceof Error ? error.message : String(error))}\n`)
  process.exitCode = 1
} finally {
  if (temporaryRoot) await fsp.rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined)
}

function packagedExecutable() {
  const releaseDirectory = path.join(root, 'release', packageMetadata.version)
  const candidates = process.platform === 'win32'
    ? [path.join(releaseDirectory, 'win-unpacked', 'Nocturne Studio.exe')]
    : process.platform === 'darwin'
      ? [path.join(releaseDirectory, 'mac', 'Nocturne Studio.app', 'Contents', 'MacOS', 'Nocturne Studio'), path.join(releaseDirectory, 'mac-arm64', 'Nocturne Studio.app', 'Contents', 'MacOS', 'Nocturne Studio'), path.join(releaseDirectory, 'mac-x64', 'Nocturne Studio.app', 'Contents', 'MacOS', 'Nocturne Studio')]
      : [path.join(releaseDirectory, 'linux-unpacked', 'nocturne-studio')]
  const executable = candidates.find((candidate) => fs.existsSync(candidate))
  if (!executable) throw new Error(`Executável empacotado não encontrado em release/${packageMetadata.version}. Execute npm run package:dir -- --publish never.`)
  return executable
}

function assertIsolatedUserData(rootDirectory, userData) {
  const temporary = path.resolve(os.tmpdir())
  const relative = path.relative(rootDirectory, userData)
  const forbidden = [
    path.join(os.homedir(), '.config', 'Nocturne Studio'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'Nocturne Studio'),
    path.join(os.homedir(), 'Library', 'Application Support', 'Nocturne Studio'),
  ].map((candidate) => path.resolve(candidate))
  if (!isInside(temporary, rootDirectory) || !isInside(rootDirectory, userData) || relative === '' || forbidden.some((candidate) => path.resolve(userData) === candidate)) {
    throw new Error('Guardrail de isolamento do userData falhou; o rehearsal foi abortado.')
  }
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

async function cloneScenario(parent, name, sourceUserData, sourceWorkspace) {
  const scenario = path.join(parent, name)
  const userData = path.join(scenario, 'user-data')
  const reportFile = path.join(scenario, 'result.json')
  await fsp.mkdir(userData, { recursive: true, mode: 0o700 })
  await fsp.mkdir(scenario, { recursive: true, mode: 0o700 })
  await copyPersistentState(sourceUserData, userData)
  return { scenario, userData, workspace: sourceWorkspace, report: reportFile, database: path.join(userData, 'nocturne.db') }
}

async function copyPersistentState(source, destination) {
  const entries = await fsp.readdir(source, { withFileTypes: true })
  for (const entry of entries) {
    if (/^(Singleton|lockfile|Cache|GPUCache|Code Cache|DawnGraph)/.test(entry.name)) continue
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isDirectory()) await fsp.cp(from, to, { recursive: true, force: true })
    else if (entry.isFile()) await fsp.copyFile(from, to)
  }
}

function corruptDatabase(userData) {
  const database = path.join(userData, 'nocturne.db')
  fs.truncateSync(database, 32)
  for (const suffix of ['-wal', '-shm']) fs.rmSync(`${database}${suffix}`, { force: true })
}

function isCorruptDatabase(filePath) {
  try {
    const stat = fs.statSync(filePath)
    return stat.size < 100 || !fs.readFileSync(filePath).subarray(0, 16).equals(Buffer.from('SQLite format 3\0'))
  } catch {
    return false
  }
}

async function launch(executable, userData, workspace, mode, output, options = {}) {
  const scenario = options.scenario || mode
  setDiagnosticStage('launch-process', scenario)
  const args = [`--user-data-dir=${userData}`]
  if (process.platform === 'linux' && process.env.CI) args.push('--no-sandbox')
  const env = {
    ...process.env,
    NOCTURNE_DISABLE_GPU: '1',
    ELECTRON_ENABLE_LOGGING: '1',
    // This existing smoke marker disables the updater without scheduling the
    // package smoke because main.ts gives the recovery harness precedence.
    NOCTURNE_PACKAGE_SMOKE_OUTPUT: path.join(path.dirname(output), 'updater-disabled.json'),
    NOCTURNE_PACKAGED_RECOVERY_OUTPUT: output,
    NOCTURNE_PACKAGED_RECOVERY_ROOT: options.harnessRoot || path.dirname(output),
    NOCTURNE_PACKAGED_RECOVERY_WORKSPACE: workspace,
    NOCTURNE_PACKAGED_RECOVERY_MODE: mode,
  }
  let result
  try {
    result = await runProcess(executable, args, env, options.timeoutMs ?? 30_000)
  } catch (error) {
    recordProcessDiagnostic(scenario, executable, null, output, error)
    throw error
  }
  recordProcessDiagnostic(scenario, executable, result, output)
  return result
}

function setDiagnosticStage(stage, scenario = report.diagnostics.currentScenario) {
  report.diagnostics.currentStage = stage
  report.diagnostics.currentScenario = scenario
}

function recordProcessDiagnostic(scenario, executable, result, output, error) {
  const partial = inspectPartialReport(output)
  const diagnostic = {
    scenario,
    stage: report.diagnostics.currentStage,
    executable: path.basename(executable),
    exitCode: result?.code ?? null,
    signal: result?.signal ?? null,
    timedOut: result?.timedOut ?? false,
    stdout: sanitizeDiagnosticText(result?.stdout ?? ''),
    stderr: sanitizeDiagnosticText(result?.stderr ?? ''),
    spawnError: error ? sanitizeError(error) : null,
    report: partial,
  }
  report.diagnostics.processes.push(diagnostic)
  if (report.diagnostics.processes.length > 20) report.diagnostics.processes.shift()
  if (partial.exists) report.diagnostics.partialReports.push({ scenario, ...partial })
}

function inspectPartialReport(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { exists: false, parseable: false }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return {
      exists: true,
      parseable: true,
      ok: parsed?.ok === true,
      phase: typeof parsed?.phase === 'string' ? parsed.phase : null,
      stage: typeof parsed?.stage === 'string' ? parsed.stage : null,
      failureFingerprint: typeof parsed?.failureFingerprint === 'string' ? parsed.failureFingerprint : null,
      errorName: typeof parsed?.errorName === 'string' ? parsed.errorName : null,
      errorMessage: typeof parsed?.errorMessage === 'string' ? sanitizeDiagnosticText(parsed.errorMessage) : null,
      pathDiagnostics: parsed?.pathDiagnostics && typeof parsed.pathDiagnostics === 'object' ? sanitizePathDiagnostics(parsed.pathDiagnostics) : null,
    }
  } catch {
    return { exists: true, parseable: false }
  }
}

function sanitizePathDiagnostics(value) {
  const allowed = [
    'rootLexicalInsideTemporary',
    'outputLexicalInsideRoot',
    'userDataExists',
    'userDataLexicalInsideTemporary',
    'canonicalTemporaryAvailable',
    'canonicalRootAvailable',
    'canonicalUserDataAvailable',
    'canonicalRootInsideTemporary',
    'canonicalUserDataInsideTemporary',
    'temporaryAliasChanged',
    'rootAliasChanged',
    'userDataAliasChanged',
  ]
  return Object.fromEntries(allowed.filter((key) => typeof value[key] === 'boolean').map((key) => [key, value[key]]))
}

function sanitizeError(error) {
  return {
    name: error instanceof Error ? error.name : typeof error,
    message: sanitizeDiagnosticText(error instanceof Error ? error.message : String(error)),
  }
}

function sanitizeDiagnosticText(value) {
  let text = String(value ?? '')
  const knownRoots = [temporaryRoot, root, process.cwd(), os.homedir()].filter(Boolean)
  for (const knownRoot of knownRoots) text = text.split(knownRoot).join('<redacted-root>')
  // Keep native error wording while removing absolute POSIX/Windows paths.
  text = text.replace(/(?:[A-Za-z]:[\\/]|\\\\|\/)(?:[^\s'"`]|\\ )+/g, '<redacted-path>')
  return text.slice(-4_000)
}

function runProcess(command, args, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      terminate(child)
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-8_000) })
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8_000) })
    child.once('error', (error) => { clearTimeout(timeout); reject(error) })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal, timedOut, stdout, stderr })
    })
  })
}

function terminate(child) {
  if (child.pid && process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
    return
  }
  child.kill('SIGTERM')
  setTimeout(() => { if (!child.killed) child.kill('SIGKILL') }, 2_000).unref()
}

async function readReport(filePath) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { return JSON.parse(await fsp.readFile(filePath, 'utf8')) }
    catch { await new Promise((resolve) => setTimeout(resolve, 25)) }
  }
  throw new Error('O aplicativo empacotado não produziu um relatório sanitizado.')
}

function assertSuccessfulFixture(result) {
  if (result.code !== 0 || result.timedOut) {
    const signal = result.signal ? `, sinal ${result.signal}` : ''
    const stderr = sanitizeDiagnosticText(result.stderr)
    throw new Error(`O aplicativo empacotado não encerrou o fixture normalmente (${result.code ?? 'sem código'}${signal}${result.timedOut ? ', timeout' : ''}).${stderr ? ` stderr: ${stderr}` : ''}`)
  }
}

function allMarkers(markers) {
  return Boolean(markers && Object.values(markers).every(Boolean))
}

function hasQuarantine(userData) {
  return fs.readdirSync(userData).some((name) => name.startsWith('database-corrupt-'))
}

async function verifyPostRecoveryRestart(executable, userData, workspace, parent) {
  const output = path.join(parent, 'post-recovery-restart.json')
  const result = await launch(executable, userData, workspace, 'verify', output, { scenario: 'post-recovery-restart' })
  if (result.code !== 0) return false
  const value = await readReport(output)
  return value.ok === true && allMarkers(value.state?.markers)
}

async function runHistoricalStartup(executable, parent) {
  const scenario = path.join(parent, 'historical-0.9.5')
  const userData = path.join(scenario, 'user-data')
  const workspace = path.join(scenario, 'workspace')
  const output = path.join(scenario, 'result.json')
  await fsp.mkdir(userData, { recursive: true, mode: 0o700 })
  await fsp.mkdir(workspace, { recursive: true, mode: 0o700 })
  await createHistoricalDatabase(path.join(userData, 'nocturne.db'), workspace)
  const result = await launch(executable, userData, workspace, 'verify-historical', output, { scenario: 'historical-startup' })
  const value = await readReport(output)
  return {
    ok: result.code === 0 && value.ok === true && value.state?.historicalMarkers?.message === true,
    migrationApplied: false,
    migrationBackupValid: null,
    preservedData: value.ok === true && value.state?.historicalMarkers?.message === true,
  }
}

async function createHistoricalDatabase(databasePath, workspace) {
  const typescript = require('typescript')
  const migrationsSource = execFileSync('git', ['show', `${historicalBaseline}:electron/database/migrations.ts`], { cwd: root, encoding: 'utf8' })
  const transpiled = typescript.transpileModule(migrationsSource, { compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2020 } }).outputText
  const source = `
    const fs = require('node:fs');
    const vm = require('node:vm');
    const createRequire = require('node:module').createRequire;
    const Database = createRequire(process.cwd() + '/package.json')('better-sqlite3');
    const moduleValue = { exports: {} };
    vm.runInNewContext(${JSON.stringify(transpiled)}, { module: moduleValue, exports: moduleValue.exports });
    const db = new Database(process.argv[1]);
    const workspace = process.argv[2];
    db.pragma('foreign_keys = ON');
    db.transaction(() => { for (const migration of moduleValue.exports.migrations) { migration.up(db); db.pragma('user_version = ' + migration.version); } })();
    const stamp = '2026-08-20T00:00:00.000Z';
    db.prepare('INSERT INTO workspaces(path,name,favorite,authorized,created_at,last_opened_at) VALUES(?,?,?,?,?,?)').run(workspace, 'Historical fixture', 1, 1, stamp, stamp);
    db.prepare('INSERT INTO conversations(id,title,workspace,created_at,updated_at) VALUES(?,?,?,?,?)').run('00000000-0000-4000-8000-000000000101', 'Historical conversation', workspace, stamp, stamp);
    db.prepare('INSERT INTO messages(id,conversation_id,role,content,created_at) VALUES(?,?,?,?,?)').run('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000101', 'assistant', 'PACKAGED_RECOVERY_HISTORICAL_MESSAGE', stamp);
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('packagedHistoricalSetting', 'PACKAGED_RECOVERY_HISTORICAL');
    db.close();
  `
  const result = spawnSync(electron, ['-e', source, databasePath, workspace], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`Não foi possível gerar o fixture histórico ${historicalBaseline}.`)
}

async function writeReport() {
  await fsp.mkdir(path.dirname(reportPath), { recursive: true })
  await fsp.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

function summarize() {
  return {
    sha: report.sha,
    version: report.version,
    platform: report.platform,
    integrity: report.integrity,
    normalRestart: report.normalRestart,
    corruptionDetected: report.corruptionDetected,
    validRecoveryRestored: report.validRecoveryRestored,
    manualRecoveryRequired: report.manualRecoveryRequired,
  }
}

function safeGit(args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim() }
  catch { return 'unknown' }
}

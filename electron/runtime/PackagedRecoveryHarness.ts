import { app, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { diagnosticFingerprint, redactLogText } from '../logging/Logger'
import type { LocalDatabase } from '../database/Database'
import { restoreDatabaseFile } from '../database/recovery'
import { canonicalizePackagedRecoveryPath, isPackagedRecoveryPathInside } from '../security/PackagedRecoveryContainment'

type PackagedRecoveryMode = 'fixture' | 'verify' | 'verify-historical' | 'engine-restore'

interface PackagedRecoveryContext {
  root: string
  output: string
  workspace: string
  mode: PackagedRecoveryMode
}

interface PackagedRecoveryDependencies {
  getWindow(): BrowserWindow | null
  getDatabase(): LocalDatabase | null
  setDatabase(value: LocalDatabase | null): void
  createDatabase(userDataPath: string): LocalDatabase
  getStage(): string
  setStage(stage: string): void
}

export function createPackagedRecoveryHarness(dependencies: PackagedRecoveryDependencies) {
  async function run() {
    try {
      setStage('validate-environment')
      const context = packagedRecoveryContext()
      setStage('validate-user-data')
      const database = dependencies.getDatabase()
      if (!database) throw new Error('Banco indisponível no harness empacotado de recovery.')
      if (context.mode === 'fixture') {
        setStage('prepare-fixture')
        fs.mkdirSync(context.workspace, { recursive: true, mode: 0o700 })
        setStage('write-fixture')
        fs.writeFileSync(path.join(context.workspace, 'PACKAGED_RECOVERY_WORKSPACE.md'), 'PACKAGED_RECOVERY_WORKSPACE', { encoding: 'utf8', mode: 0o600 })
        const conversation = database.createConversation(context.workspace)
        database.renameFromPrompt(conversation.id, 'PACKAGED_RECOVERY_CONVERSATION')
        database.addMessage(conversation.id, 'user', 'PACKAGED_RECOVERY_MESSAGE_A')
        database.addMessage(conversation.id, 'assistant', 'PACKAGED_RECOVERY_MESSAGE_B')
        database.addArtifact(conversation.id, context.workspace, 'markdown', 'PACKAGED_RECOVERY_ARTIFACT', 'PACKAGED_RECOVERY_WORKSPACE.md', 'PACKAGED_RECOVERY_ARTIFACT')
        database.setWorkspaceMemory(context.workspace, 'PACKAGED_RECOVERY_MEMORY')
        database.addSuggestion(conversation.id, context.workspace, {
          title: 'PACKAGED_RECOVERY_SUGGESTION',
          description: 'Fixture sintético de recuperação empacotada.',
          reasoning: 'Exercitar preservação semântica.',
          category: 'testing',
          severity: 'low',
          affectedFiles: ['PACKAGED_RECOVERY_WORKSPACE.md'],
          proposedChanges: 'Nenhuma alteração.',
          expectedBenefits: ['Evidência reproduzível.'],
          complexity: 'low',
          risk: 'low',
          evidence: [{ source: 'packaged-recovery', detail: 'Fixture sintético.' }],
          confidence: 100,
          source: 'packaged-recovery',
          responsible: 'harness',
        })
        database.createBrainMemory(context.workspace, {
          kind: 'decision',
          scope: 'workspace',
          content: 'PACKAGED_RECOVERY_MEMORY',
          confidence: 100,
          sourceType: 'manual',
          status: 'active',
        })
        database.setSettings({ packagedRecoverySetting: 'PACKAGED_RECOVERY_SETTING' })
      }
      if (context.mode === 'engine-restore') {
        setStage('open-database')
        const userDataPath = app.getPath('userData')
        const databasePath = path.join(userDataPath, 'nocturne.db')
        const candidateName = fs.readdirSync(userDataPath).find((name) => name.startsWith('nocturne.db.recovery-engine'))
        if (!candidateName) throw new Error('Candidato do engine smoke não encontrado.')
        database.close()
        dependencies.setDatabase(null)
        fs.truncateSync(databasePath, 32)
        const quarantine = await restoreDatabaseFile(userDataPath, path.join(userDataPath, candidateName))
        dependencies.setDatabase(dependencies.createDatabase(userDataPath))
        const state = packagedRecoveryState(context)
        setStage('write-report')
        writePackagedRecoveryResult(context, {
          ok: Object.values(state.markers).every(Boolean),
          phase: 'engine-restore',
          recoveryEngine: { restored: true, corruptOriginalPreserved: fs.existsSync(path.join(quarantine, 'nocturne.db')) },
          state,
        })
      } else if (context.mode === 'fixture') {
        const state = packagedRecoveryState(context)
        setStage('write-report')
        writePackagedRecoveryResult(context, { ok: Object.values(state.markers).every(Boolean), phase: context.mode, state })
      } else {
        setStage('open-database')
        const state = packagedRecoveryState(context)
        if (context.mode === 'verify-historical') {
          const historical = Object.values(state.historicalMarkers).every(Boolean)
          setStage('write-report')
          writePackagedRecoveryResult(context, { ok: historical, phase: 'historical-startup', state })
        } else {
          const markers = Object.values(state.markers).every(Boolean)
          const workspaceRows = await dependencies.getWindow()?.webContents.executeJavaScript('window.nocturne.workspace.list()') as Array<{ path?: string; authorized?: boolean }> | undefined
          const missingWorkspace = workspaceRows?.find((item) => item.path === context.workspace)
          state.workspace.authorizationRefusedWhenMissing = !state.workspace.filesystemPresent && missingWorkspace?.authorized === false
          setStage('write-report')
          writePackagedRecoveryResult(context, { ok: markers, phase: context.mode, state })
        }
      }
      setStage('shutdown')
      app.quit()
    } catch (error) {
      writePackagedRecoveryFailure(error, 'harness-failure')
      app.exit(1)
    }
  }

  function writeStartupFailure(error: unknown) {
    setStage('startup')
    writePackagedRecoveryFailure(error, 'startup-failure')
  }

  function setStage(stage: string) {
    dependencies.setStage(stage)
  }

  function sanitizePackagedRecoveryText(value: string) {
    const knownRoots = [process.cwd(), os.homedir(), path.resolve(os.tmpdir()), process.env.NOCTURNE_PACKAGED_RECOVERY_ROOT].filter((entry): entry is string => Boolean(entry))
    let text = redactLogText(value)
    for (const root of knownRoots) text = text.split(root).join('<redacted-root>')
    text = text.replace(/(?:[A-Za-z]:[\\/]|\\\\|\/)(?:[^\s'"`]|\\ )+/g, '<redacted-path>')
    return text.slice(0, 2_000)
  }

  function packagedRecoveryOutputContext() {
    const rootValue = process.env.NOCTURNE_PACKAGED_RECOVERY_ROOT
    const outputValue = process.env.NOCTURNE_PACKAGED_RECOVERY_OUTPUT
    if (!rootValue || !outputValue) return null
    const root = path.resolve(rootValue)
    const output = path.resolve(outputValue)
    const temporaryRoot = path.resolve(os.tmpdir())
    if (!isPackagedRecoveryPathInside(temporaryRoot, root) || !isPackagedRecoveryPathInside(root, output)) return null
    return { root, output }
  }

  function inspectPackagedRecoveryPaths() {
    const rootValue = process.env.NOCTURNE_PACKAGED_RECOVERY_ROOT
    const outputValue = process.env.NOCTURNE_PACKAGED_RECOVERY_OUTPUT
    const temporaryRoot = path.resolve(os.tmpdir())
    const root = rootValue ? path.resolve(rootValue) : null
    const output = outputValue ? path.resolve(outputValue) : null
    const userData = path.resolve(app.getPath('userData'))
    const canonical = (value: string | null) => value ? canonicalizePackagedRecoveryPath(value) : null
    const canonicalTemporaryRoot = canonical(temporaryRoot)
    const canonicalRoot = canonical(root)
    const canonicalUserData = canonical(userData)
    return {
      rootLexicalInsideTemporary: Boolean(root && isLexicalPathInside(temporaryRoot, root)),
      outputLexicalInsideRoot: Boolean(root && output && isLexicalPathInside(root, output)),
      userDataExists: fs.existsSync(userData),
      userDataLexicalInsideTemporary: isLexicalPathInside(temporaryRoot, userData),
      canonicalTemporaryAvailable: Boolean(canonicalTemporaryRoot),
      canonicalRootAvailable: Boolean(canonicalRoot),
      canonicalUserDataAvailable: Boolean(canonicalUserData),
      canonicalRootInsideTemporary: Boolean(canonicalTemporaryRoot && canonicalRoot && isPackagedRecoveryPathInside(canonicalTemporaryRoot, canonicalRoot)),
      canonicalUserDataInsideTemporary: Boolean(canonicalTemporaryRoot && canonicalUserData && isPackagedRecoveryPathInside(canonicalTemporaryRoot, canonicalUserData)),
      temporaryAliasChanged: Boolean(canonicalTemporaryRoot && canonicalTemporaryRoot !== temporaryRoot),
      rootAliasChanged: Boolean(canonicalRoot && root && canonicalRoot !== root),
      userDataAliasChanged: Boolean(canonicalUserData && canonicalUserData !== userData),
    }
  }

  function writePackagedRecoveryFailure(error: unknown, phase: string) {
    const outputContext = packagedRecoveryOutputContext()
    if (!outputContext) return
    try {
      fs.mkdirSync(path.dirname(outputContext.output), { recursive: true, mode: 0o700 })
      const errorMessage = error instanceof Error ? error.message : String(error)
      fs.writeFileSync(outputContext.output, `${JSON.stringify({
        packaged: app.isPackaged,
        mode: process.env.NOCTURNE_PACKAGED_RECOVERY_MODE ?? null,
        ok: false,
        phase,
        stage: dependencies.getStage(),
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: sanitizePackagedRecoveryText(errorMessage),
        failureFingerprint: diagnosticFingerprint(`${errorMessage}\n${error instanceof Error ? error.stack ?? '' : ''}`),
        pathDiagnostics: inspectPackagedRecoveryPaths(),
      })}\n`, { encoding: 'utf8', mode: 0o600 })
    } catch { /* diagnostics must not replace the original failure */ }
  }

  function packagedRecoveryContext(): PackagedRecoveryContext {
    const rootValue = process.env.NOCTURNE_PACKAGED_RECOVERY_ROOT
    const outputValue = process.env.NOCTURNE_PACKAGED_RECOVERY_OUTPUT
    const workspaceValue = process.env.NOCTURNE_PACKAGED_RECOVERY_WORKSPACE
    const mode = process.env.NOCTURNE_PACKAGED_RECOVERY_MODE as PackagedRecoveryMode | undefined
    if (!rootValue || !outputValue || !workspaceValue || !mode || !['fixture', 'verify', 'verify-historical', 'engine-restore'].includes(mode)) {
      throw new Error('Configuração incompleta do harness empacotado de recovery.')
    }
    const root = path.resolve(rootValue)
    const output = path.resolve(outputValue)
    const workspace = path.resolve(workspaceValue)
    const temporaryRoot = path.resolve(os.tmpdir())
    const userData = path.resolve(app.getPath('userData'))
    if (!isPackagedRecoveryPathInside(temporaryRoot, root) || !isPackagedRecoveryPathInside(root, output) || !isPackagedRecoveryPathInside(root, workspace) || !isPackagedRecoveryPathInside(root, userData)) {
      throw new Error('O harness empacotado exige userData, workspace e relatório dentro de um diretório temporário isolado.')
    }
    return { root, output, workspace, mode }
  }

  function writePackagedRecoveryResult(context: PackagedRecoveryContext, value: Record<string, unknown>) {
    fs.mkdirSync(path.dirname(context.output), { recursive: true, mode: 0o700 })
    fs.writeFileSync(context.output, `${JSON.stringify({ packaged: app.isPackaged, mode: context.mode, stage: dependencies.getStage(), ...value })}\n`, { encoding: 'utf8', mode: 0o600 })
  }

  function packagedRecoveryState(context: PackagedRecoveryContext) {
    const database = dependencies.getDatabase()
    if (!database) throw new Error('Banco indisponível no harness empacotado de recovery.')
    const conversations = database.listConversations()
    const conversation = conversations.find((item) => item.workspace === context.workspace)
    const messages = conversation ? database.listMessages(conversation.id) : []
    const artifacts = conversation ? database.listArtifacts(conversation.id) : []
    const suggestions = conversation ? database.listSuggestions(conversation.id) : []
    const memories = database.listBrainMemoryPage(context.workspace, 0, 50).items
    const workspaceRows = database.listWorkspaces()
    return {
      schemaVersion: database.exportData().schemaVersion,
      records: { workspaces: workspaceRows.length, conversations: conversations.length, messages: messages.length, artifacts: artifacts.length, suggestions: suggestions.length, memories: memories.length },
      markers: {
        conversation: Boolean(conversation?.title === 'PACKAGED_RECOVERY_CONVERSATION'),
        messageA: messages.some((message) => message.content === 'PACKAGED_RECOVERY_MESSAGE_A'),
        messageB: messages.some((message) => message.content === 'PACKAGED_RECOVERY_MESSAGE_B'),
        artifact: artifacts.some((artifact) => artifact.content === 'PACKAGED_RECOVERY_ARTIFACT'),
        suggestion: suggestions.some((suggestion) => suggestion.title === 'PACKAGED_RECOVERY_SUGGESTION'),
        memory: memories.some((memory) => memory.content === 'PACKAGED_RECOVERY_MEMORY'),
        setting: database.getSettings().packagedRecoverySetting === 'PACKAGED_RECOVERY_SETTING',
      },
      historicalMarkers: {
        message: messages.some((message) => message.content === 'PACKAGED_RECOVERY_HISTORICAL_MESSAGE'),
        setting: database.getSettings().packagedHistoricalSetting === 'PACKAGED_RECOVERY_HISTORICAL',
      },
      workspace: { historyPresent: workspaceRows.some((item) => item.path === context.workspace), filesystemPresent: fs.existsSync(context.workspace), authorizationRefusedWhenMissing: false },
    }
  }

  return { run, writeStartupFailure }
}

function isLexicalPathInside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

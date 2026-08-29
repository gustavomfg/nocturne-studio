import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { redactLogText } from '../logging/Logger'
import { isWorkspaceFileTooLarge, readWorkspaceFile, resolveInsideWorkspace, sanitizeWorkspaceReadError } from '../security/ExecutionPolicy'
import { sanitizeSuggestionTitle } from '../../shared/suggestions'
import { appendSuggestionDecision } from '../persistence/SuggestionDecisionLog'
import { writeAtomicFile } from '../persistence/AtomicFile'
import { enqueueSerializedWrite } from '../persistence/SerializedWriteQueue'
import { WORKSPACE_READ_LIMITS } from '../../shared/constants'
import type { ProjectContext } from '../../shared/types'

const execFileAsync = promisify(execFile)

export async function runWorkspaceCommand(command: string, args: string[], cwd: string) {
  try {
    return await execFileAsync(command, args, { cwd, timeout: 20_000, maxBuffer: 5_000_000 })
  } catch (error) {
    throw new Error(error instanceof Error ? redactLogText(error.message.slice(0, 2_000)) : String(error))
  }
}

export async function ensureNocturneWorkspace(workspace: string) {
  const directory = path.join(workspace, '.nocturne')
  await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 })
  resolveInsideWorkspace(directory, workspace)
  const projectPath = path.join(directory, 'project.json')
  const memoryPath = path.join(directory, 'memory.md')
  const rulesPath = path.join(directory, 'rules.md')
  const project = await detectProject(workspace)
  await Promise.all([
    ensureProjectMetadata(projectPath, workspace, project),
    writeIfMissing(memoryPath, '# Memória do projeto\n\nDecisões, arquitetura e informações aprendidas pelo agente.\n'),
    writeIfMissing(rulesPath, '# Regras do projeto\n\nPreferências e padrões de código que o agente deve seguir.\n'),
  ])
}

export async function readWorkspaceContext(workspace: string) {
  await ensureNocturneWorkspace(workspace)
  const directory = path.join(workspace, '.nocturne')
  let project = await detectProject(workspace)
  try {
    project = JSON.parse((await readWorkspaceFile(
      path.join(directory, 'project.json'),
      workspace,
      WORKSPACE_READ_LIMITS.projectMetadataBytes,
    )).content.toString('utf8')) as ProjectContext
  } catch (error) {
    if (isWorkspaceFileTooLarge(error)) throw new Error('O metadata do projeto excede o limite permitido.')
    if (!((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError)) {
      throw sanitizeWorkspaceReadError(error, 'Não foi possível ler o metadata do projeto com segurança.')
    }
    // Regenerate invalid metadata on save, preserving the existing contract.
  }
  const memoryPath = path.join(directory, 'memory.md')
  const rulesPath = path.join(directory, 'rules.md')
  const [memory, rules] = await Promise.all([
    readWorkspaceContextFile(memoryPath, workspace),
    readWorkspaceContextFile(rulesPath, workspace),
  ])
  return {
    content: memory.content.toString('utf8'),
    rules: rules.content.toString('utf8'),
    project,
    updatedAt: new Date(Math.max(memory.stat.mtimeMs, rules.stat.mtimeMs)).toISOString(),
  }
}

export async function writeWorkspaceContext(workspace: string, content: string, rules: string) {
  return enqueueSerializedWrite(workspace, async () => {
    await ensureNocturneWorkspace(workspace)
    const directory = path.join(workspace, '.nocturne')
    const project = await detectProject(workspace)
    await Promise.all([
      writeAtomicFile(path.join(directory, 'memory.md'), content),
      writeAtomicFile(path.join(directory, 'rules.md'), rules),
      writeAtomicFile(path.join(directory, 'project.json'), `${JSON.stringify(project, null, 2)}\n`),
    ])
    return { content, rules, project, updatedAt: new Date().toISOString() }
  })
}

export async function recordSuggestionDecision(
  workspace: string,
  suggestion: { title: string; status: string; updatedAt: string },
) {
  await ensureNocturneWorkspace(workspace)
  const memoryPath = path.join(workspace, '.nocturne', 'memory.md')
  await appendSuggestionDecision(workspace, memoryPath, {
    ...suggestion,
    title: sanitizeSuggestionTitle(suggestion.title),
  })
}

async function readWorkspaceContextFile(filePath: string, workspace: string) {
  try {
    return await readWorkspaceFile(filePath, workspace, WORKSPACE_READ_LIMITS.workspaceContextBytes)
  } catch (error) {
    if (isWorkspaceFileTooLarge(error)) throw new Error('O contexto do workspace excede o limite permitido.')
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Arquivo de contexto do workspace não encontrado.')
    throw sanitizeWorkspaceReadError(error, 'Não foi possível ler o contexto do workspace com segurança.')
  }
}

async function detectProject(workspace: string): Promise<ProjectContext> {
  const files = new Set(await fs.promises.readdir(workspace))
  const stack: string[] = []
  const commands: Record<string, string> = {}
  let primaryLanguage = 'Desconhecida'
  if (files.has('package.json')) {
    stack.push('Node.js')
    primaryLanguage = files.has('tsconfig.json') ? 'TypeScript' : 'JavaScript'
    try {
      const pkg = JSON.parse((await readWorkspaceFile(
        path.join(workspace, 'package.json'),
        workspace,
        WORKSPACE_READ_LIMITS.packageMetadataBytes,
      )).content.toString('utf8')) as {
        scripts?: Record<string, string>
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      Object.assign(commands, pkg.scripts ?? {})
      const deps = { ...pkg.dependencies, ...pkg.devDependencies }
      for (const [dependency, label] of Object.entries({
        react: 'React',
        vue: 'Vue',
        electron: 'Electron',
        next: 'Next.js',
        vite: 'Vite',
      })) {
        if (deps[dependency]) stack.push(label)
      }
    } catch (error) {
      if (isWorkspaceFileTooLarge(error)) throw new Error('O package.json excede o limite permitido.')
      if (!((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError)) {
        throw sanitizeWorkspaceReadError(error, 'Não foi possível ler o package.json com segurança.')
      }
      /* keep basic detection for missing or malformed package metadata */
    }
  }
  if (files.has('Cargo.toml')) {
    stack.push('Rust')
    primaryLanguage = 'Rust'
    commands.test = 'cargo test'
  }
  if (files.has('pyproject.toml') || files.has('requirements.txt')) {
    stack.push('Python')
    primaryLanguage = 'Python'
    commands.test ??= 'pytest'
  }
  if (files.has('go.mod')) {
    stack.push('Go')
    primaryLanguage = 'Go'
    commands.test = 'go test ./...'
  }
  return { name: path.basename(workspace), stack: [...new Set(stack)], primaryLanguage, commands }
}

async function writeIfMissing(filePath: string, content: string) {
  try {
    await fs.promises.writeFile(filePath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

async function ensureProjectMetadata(filePath: string, workspace: string, project: ProjectContext) {
  let current: unknown
  try {
    current = JSON.parse((await readWorkspaceFile(
      filePath,
      workspace,
      WORKSPACE_READ_LIMITS.projectMetadataBytes,
    )).content.toString('utf8'))
  } catch (error) {
    if (isWorkspaceFileTooLarge(error)) throw new Error('O metadata do projeto excede o limite permitido.')
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) {
      throw sanitizeWorkspaceReadError(error, 'Não foi possível ler o metadata do projeto com segurança.')
    }
  }
  if (isProjectContext(current) && projectContextsEqual(current, project)) return
  await writeAtomicFile(filePath, `${JSON.stringify(project, null, 2)}\n`)
}

function isProjectContext(value: unknown): value is ProjectContext {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ProjectContext>
  return typeof candidate.name === 'string'
    && Array.isArray(candidate.stack)
    && candidate.stack.every((item) => typeof item === 'string')
    && typeof candidate.primaryLanguage === 'string'
    && Boolean(candidate.commands)
    && typeof candidate.commands === 'object'
    && !Array.isArray(candidate.commands)
    && Object.entries(candidate.commands).every(([key, command]) => typeof key === 'string' && typeof command === 'string')
}

function projectContextsEqual(left: ProjectContext, right: ProjectContext) {
  const leftCommands = Object.entries(left.commands)
  const rightCommands = Object.entries(right.commands)
  return left.name === right.name
    && left.primaryLanguage === right.primaryLanguage
    && left.stack.length === right.stack.length
    && left.stack.every((item, index) => item === right.stack[index])
    && leftCommands.length === rightCommands.length
    && leftCommands.every(([key, command]) => right.commands[key] === command)
}

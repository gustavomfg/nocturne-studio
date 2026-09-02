import fs from 'node:fs'
import path from 'node:path'
import { CODE_INTELLIGENCE_LIMITS } from '../../shared/constants'
import type { DiscoveryExclusion, DiscoveryFileClassification, DiscoveredFile, WorkspaceDiscoveryResult } from '../../shared/codeIntelligence'
import { isIgnoredProjectDiscoveryRelativePath } from '../workspaces/WorkspacePathPolicy'

const CONFIGURATION_FILE_NAMES = new Set([
  'package.json',
  'tsconfig.json',
  'tsconfig.base.json',
  'vite.config.js',
  'vite.config.ts',
  'vite.config.mjs',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'nuxt.config.ts',
  'nuxt.config.js',
  'webpack.config.js',
  'webpack.config.ts',
  'rollup.config.js',
  'rollup.config.ts',
  'cargo.toml',
  'pyproject.toml',
  'requirements.txt',
  'requirements-dev.txt',
  'go.mod',
  'go.work',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'makefile',
  'biome.json',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'playwright.config.ts',
  'playwright.config.js',
  'vitest.config.ts',
  'vitest.config.js',
  'jest.config.js',
  'jest.config.ts',
  '.gitignore',
  '.nvmrc',
  '.tool-versions',
])

const LOCKFILE_NAMES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock'])
const DOCUMENTATION_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc'])
const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
  '.py', '.rs', '.go', '.java', '.kt', '.kts', '.c', '.h', '.cc', '.cpp', '.hpp',
  '.cs', '.swift', '.rb', '.php', '.ex', '.exs', '.lua', '.sh', '.bash', '.zsh',
  '.css', '.scss', '.sass', '.less', '.html', '.vue', '.svelte',
])
const ASSET_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.toml', '.xml', '.sql', '.graphql', '.gql'])

export interface WorkspaceDiscoveryOptions {
  maxFiles?: number
  maxExclusions?: number
}

export class WorkspaceDiscoveryService {
  constructor(private readonly options: WorkspaceDiscoveryOptions = {}) {}

  async discover(workspace: string, requestedPaths?: string[], signal?: AbortSignal): Promise<WorkspaceDiscoveryResult> {
    const root = path.resolve(workspace)
    const files: DiscoveredFile[] = []
    const exclusions: DiscoveryExclusion[] = []
    const configurationFiles: string[] = []
    const missingPaths: string[] = []
    const maxFiles = this.options.maxFiles ?? CODE_INTELLIGENCE_LIMITS.maxFiles
    const maxExclusions = this.options.maxExclusions ?? CODE_INTELLIGENCE_LIMITS.maxExclusions
    let truncated = false

    const addExclusion = (relativePath: string, reason: string) => {
      if (exclusions.length < maxExclusions) exclusions.push({ relativePath, reason })
    }

    const addFile = async (absolutePath: string, relativePath: string, entryName: string): Promise<void> => {
      assertNotCancelled(signal)
      let stat: fs.Stats
      try {
        stat = await fs.promises.lstat(absolutePath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          missingPaths.push(relativePath)
          return
        }
        addExclusion(relativePath, 'Não foi possível consultar o caminho.')
        return
      }
      if (stat.isDirectory()) {
        await visit(absolutePath, relativePath)
        return
      }
      if (stat.isSymbolicLink()) {
        addExclusion(relativePath, 'Links simbólicos não são seguidos pela indexação.')
        return
      }
      if (!stat.isFile()) {
        addExclusion(relativePath, 'Entrada especial não é indexada.')
        return
      }
      if (files.length >= maxFiles) {
        truncated = true
        addExclusion(relativePath, 'Limite de arquivos da indexação atingido.')
        return
      }
      const classification = classifyFile(relativePath)
      const file: DiscoveredFile = {
        relativePath,
        classification,
        extension: path.extname(entryName).toLowerCase(),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs,
        mode: stat.mode,
      }
      files.push(file)
      if (classification === 'configuration' || classification === 'lockfile') configurationFiles.push(relativePath)
    }

    const visitedDirectories = new Set<string>()
    const visit = async (directory: string, prefix: string): Promise<void> => {
      assertNotCancelled(signal)
      if (visitedDirectories.has(directory)) return
      visitedDirectories.add(directory)
      let entries: fs.Dirent[]
      try {
        entries = await fs.promises.readdir(directory, { withFileTypes: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }

      for (const entry of entries) {
        assertNotCancelled(signal)
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
        if (isIgnoredProjectDiscoveryRelativePath(relativePath)) {
          addExclusion(relativePath, 'Diretório gerado ou de controle excluído da indexação.')
          continue
        }
        await addFile(path.join(directory, entry.name), relativePath, entry.name)
      }
    }

    const normalizedPaths = requestedPaths === undefined
      ? null
      : [...new Set(requestedPaths.map((candidate) => candidate.replace(/\\/g, '/')).map((candidate) => path.posix.normalize(candidate)).filter((candidate) => candidate && candidate !== '.' && !candidate.startsWith('../') && candidate !== '..'))]
    if (normalizedPaths === null) await visit(root, '')
    else {
      for (const relativePath of normalizedPaths) {
        assertNotCancelled(signal)
        if (isIgnoredProjectDiscoveryRelativePath(relativePath)) {
          addExclusion(relativePath, 'Diretório gerado ou de controle excluído da indexação.')
          continue
        }
        await addFile(path.join(root, ...relativePath.split('/')), relativePath, path.basename(relativePath))
      }
    }
    files.sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0)
    configurationFiles.sort()
    exclusions.sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0)
    missingPaths.sort()
    return { workspace: root, files, configurationFiles, exclusions, missingPaths, completedAt: new Date().toISOString(), truncated }
  }
}

function assertNotCancelled(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new Error('Indexação cancelada.')
}

export function classifyFile(relativePath: string): DiscoveryFileClassification {
  const baseName = path.basename(relativePath).toLowerCase()
  if (isConfigurationBaseName(baseName)) return 'configuration'
  if (LOCKFILE_NAMES.has(baseName)) return 'lockfile'
  const extension = path.extname(baseName)
  if (DOCUMENTATION_EXTENSIONS.has(extension)) return 'documentation'
  if (SOURCE_EXTENSIONS.has(extension)) return 'source'
  if (ASSET_EXTENSIONS.has(extension)) return 'asset'
  return 'unknown'
}

export function isConfigurationFile(relativePath: string) {
  const baseName = path.basename(relativePath).toLowerCase()
  return isConfigurationBaseName(baseName) || LOCKFILE_NAMES.has(baseName)
}

function isConfigurationBaseName(baseName: string) {
  return CONFIGURATION_FILE_NAMES.has(baseName)
    || /^tsconfig(?:\.[^.]+)*\.json$/.test(baseName)
    || /^(?:vite|next|nuxt|webpack|rollup|esbuild|rspack|playwright|vitest|jest)\.config(?:\.[^.]+)+$/.test(baseName)
    || /^\.?(?:eslintrc|prettierrc)(?:\.[^.]+)?$/.test(baseName)
    || /^requirements(?:-[^.]+)?\.txt$/.test(baseName)
}

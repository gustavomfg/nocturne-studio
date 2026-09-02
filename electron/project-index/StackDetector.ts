import crypto from 'node:crypto'
import path from 'node:path'
import { WORKSPACE_READ_LIMITS } from '../../shared/constants'
import type { DetectedStack, DiscoveredFile, StackEvidence, StackEvidenceCategory, WorkspaceDiscoveryResult } from '../../shared/codeIntelligence'
import { readWorkspaceFile } from '../security/ExecutionPolicy'

interface PackageMetadata {
  scripts?: unknown
  dependencies?: unknown
  devDependencies?: unknown
  peerDependencies?: unknown
}

const FRAMEWORK_DEPENDENCIES: Record<string, string> = {
  react: 'React',
  'react-dom': 'React DOM',
  vue: 'Vue',
  svelte: 'Svelte',
  '@angular/core': 'Angular',
  next: 'Next.js',
  nuxt: 'Nuxt',
  electron: 'Electron',
}

const BUNDLER_DEPENDENCIES: Record<string, string> = {
  vite: 'Vite',
  webpack: 'Webpack',
  rollup: 'Rollup',
  parcel: 'Parcel',
  esbuild: 'esbuild',
  '@rspack/core': 'Rspack',
}

const TEST_DEPENDENCIES: Record<string, string> = {
  vitest: 'Vitest',
  jest: 'Jest',
  mocha: 'Mocha',
  '@playwright/test': 'Playwright',
  cypress: 'Cypress',
  pytest: 'pytest',
}

const TYPECHECK_DEPENDENCIES: Record<string, string> = {
  typescript: 'TypeScript',
  mypy: 'mypy',
  pyright: 'Pyright',
}

const LINT_DEPENDENCIES: Record<string, string> = {
  eslint: 'ESLint',
  '@biomejs/biome': 'Biome',
  biome: 'Biome',
  oxlint: 'oxlint',
  ruff: 'Ruff',
}

const BUILD_DEPENDENCIES: Record<string, string> = {
  'electron-builder': 'electron-builder',
  'tsup': 'tsup',
  'turbo': 'Turborepo',
  nx: 'Nx',
}

export class StackDetector {
  async detect(workspace: string, discovery: WorkspaceDiscoveryResult, signal?: AbortSignal): Promise<DetectedStack> {
    assertNotCancelled(signal)
    const evidence: StackEvidence[] = []
    const commands: Record<string, string> = {}
    const seen = new Set<string>()
    const add = (category: StackEvidenceCategory, value: string, sourcePath: string, sourceHash: string, reason: string, confidence = 80, sourceLine: number | null = null) => {
      const normalizedValue = value.trim()
      if (!normalizedValue) return
      const key = `${category}:${normalizedValue}:${sourcePath}:${sourceHash}:${reason}`
      if (seen.has(key)) return
      seen.add(key)
      evidence.push({
        id: stableEvidenceId(workspace, category, normalizedValue, sourcePath, sourceHash, reason),
        workspace,
        category,
        value: normalizedValue,
        confidence,
        sourcePath,
        sourceHash,
        sourceLine,
        reason,
        detectedAt: new Date().toISOString(),
      })
    }

    const fileMap = new Map(discovery.files.map((file) => [file.relativePath, file]))
    const readConfig = async (relativePath: string) => {
      assertNotCancelled(signal)
      const file = fileMap.get(relativePath)
      if (!file) return null
      try {
        const result = await readWorkspaceFile(relativePath, workspace, WORKSPACE_READ_LIMITS.packageMetadataBytes)
        assertNotCancelled(signal)
        return { file, text: result.content.toString('utf8'), hash: hashBuffer(result.content) }
      } catch (error) {
        if (signal?.aborted) throw error
        return null
      }
    }

    const packageFile = findFile(fileMap, 'package.json')
    if (packageFile) {
      const packageData = await readConfig(packageFile.relativePath)
      if (packageData) {
        add('runtime', 'Node.js', packageData.file.relativePath, packageData.hash, 'package.json identifica um projeto Node.js.', 90)
        const metadata = parsePackage(packageData.text)
        const dependencies = { ...metadata.dependencies, ...metadata.devDependencies, ...metadata.peerDependencies }
        for (const [dependency, label] of Object.entries(FRAMEWORK_DEPENDENCIES)) {
          if (dependencies[dependency]) add('framework', label, packageData.file.relativePath, packageData.hash, `Dependência "${dependency}" encontrada no package.json.`, 90)
        }
        for (const [dependency, label] of Object.entries(BUNDLER_DEPENDENCIES)) {
          if (dependencies[dependency]) add('bundler', label, packageData.file.relativePath, packageData.hash, `Dependência "${dependency}" encontrada no package.json.`, 90)
        }
        for (const [dependency, label] of Object.entries(TEST_DEPENDENCIES)) {
          if (dependencies[dependency]) add('test', label, packageData.file.relativePath, packageData.hash, `Dependência "${dependency}" encontrada no package.json.`, 90)
        }
        for (const [dependency, label] of Object.entries(TYPECHECK_DEPENDENCIES)) {
          if (dependencies[dependency]) add('typecheck', label, packageData.file.relativePath, packageData.hash, `Ferramenta de typecheck "${dependency}" encontrada no package.json.`, 90)
        }
        for (const [dependency, label] of Object.entries(LINT_DEPENDENCIES)) {
          if (dependencies[dependency]) add('lint', label, packageData.file.relativePath, packageData.hash, `Ferramenta de lint "${dependency}" encontrada no package.json.`, 90)
        }
        for (const [dependency, label] of Object.entries(BUILD_DEPENDENCIES)) {
          if (dependencies[dependency]) add('build', label, packageData.file.relativePath, packageData.hash, `Dependência "${dependency}" encontrada no package.json.`, 90)
        }
        for (const [name, command] of Object.entries(metadata.scripts)) {
          commands[name] = command
          add('script', `${name}=${command}`, packageData.file.relativePath, packageData.hash, `Script "${name}" declarado no package.json.`, 85)
          if (/^(test|check|verify|e2e|spec)/i.test(name)) add('test', name, packageData.file.relativePath, packageData.hash, `Script "${name}" sugere uma etapa de testes ou verificação.`, 75)
          if (/^(build|bundle|compile|package)/i.test(name)) add('build', name, packageData.file.relativePath, packageData.hash, `Script "${name}" sugere uma etapa de build.`, 75)
          if (/^(lint|format|style)/i.test(name)) add('test', name, packageData.file.relativePath, packageData.hash, `Script "${name}" sugere uma etapa de qualidade.`, 70)
        }
      }
    }

    for (const file of discovery.files) {
      assertNotCancelled(signal)
      const baseName = path.basename(file.relativePath).toLowerCase()
      if (baseName === 'package-lock.json' || baseName === 'npm-shrinkwrap.json') await addPackageManager('npm', file)
      if (baseName === 'yarn.lock') await addPackageManager('Yarn', file)
      if (baseName === 'pnpm-lock.yaml') await addPackageManager('pnpm', file)
      if (baseName === 'bun.lock' || baseName === 'bun.lockb') await addPackageManager('Bun', file)
      if (baseName === 'tsconfig.json' || /^tsconfig\..+\.json$/.test(baseName)) {
        const config = await readConfig(file.relativePath)
        if (config) add('language', 'TypeScript', file.relativePath, config.hash, 'Configuração TypeScript encontrada.', 95)
      }
      if (baseName === 'cargo.toml') {
        const config = await readConfig(file.relativePath)
        if (config) {
          add('language', 'Rust', file.relativePath, config.hash, 'Manifest Cargo encontrado.', 95)
          add('runtime', 'Rust', file.relativePath, config.hash, 'Manifest Cargo identifica um projeto Rust.', 90)
          commands.test ??= 'cargo test'
          add('test', 'cargo test', file.relativePath, config.hash, 'Comando padrão de testes do Cargo.', 70)
          add('build', 'cargo build', file.relativePath, config.hash, 'Comando padrão de build do Cargo.', 70)
        }
      }
      if (baseName === 'pyproject.toml' || /^requirements(?:-[^.]+)?\.txt$/.test(baseName)) {
        const config = await readConfig(file.relativePath)
        if (config) {
          add('language', 'Python', file.relativePath, config.hash, 'Manifesto ou lista de dependências Python encontrada.', 90)
          add('runtime', 'Python', file.relativePath, config.hash, 'Manifesto ou lista de dependências Python identifica o runtime.', 85)
          commands.test ??= 'pytest'
          add('test', 'pytest', file.relativePath, config.hash, 'Comando padrão de testes Python detectado.', 65)
        }
      }
      if (baseName === 'go.mod' || baseName === 'go.work') {
        const config = await readConfig(file.relativePath)
        if (config) {
          add('language', 'Go', file.relativePath, config.hash, 'Manifesto Go encontrado.', 95)
          add('runtime', 'Go', file.relativePath, config.hash, 'Manifesto Go identifica um projeto Go.', 90)
          commands.test ??= 'go test ./...'
          add('test', 'go test ./...', file.relativePath, config.hash, 'Comando padrão de testes do Go.', 70)
          add('build', 'go build ./...', file.relativePath, config.hash, 'Comando padrão de build do Go.', 65)
        }
      }
      if (baseName === 'dockerfile') {
        const config = await readConfig(file.relativePath)
        if (config) add('build', 'Docker', file.relativePath, config.hash, 'Dockerfile encontrado.', 85)
      }
      const hasStackConfig = /^(?:vite|webpack|rollup|esbuild|rspack|playwright|vitest|jest)\.config\./.test(baseName)
        || /^(?:eslint\.config\.|\.eslintrc)/.test(baseName)
      if (!hasStackConfig) continue
      const config = await readConfig(file.relativePath)
      if (!config) continue
      if (/^vite\.config\./.test(baseName)) add('bundler', 'Vite', file.relativePath, config.hash, 'Configuração Vite encontrada.', 85)
      if (/^webpack\.config\./.test(baseName)) add('bundler', 'Webpack', file.relativePath, config.hash, 'Configuração Webpack encontrada.', 85)
      if (/^rollup\.config\./.test(baseName)) add('bundler', 'Rollup', file.relativePath, config.hash, 'Configuração Rollup encontrada.', 85)
      if (/^esbuild\.config\./.test(baseName)) add('bundler', 'esbuild', file.relativePath, config.hash, 'Configuração esbuild encontrada.', 85)
      if (/^rspack\.config\./.test(baseName)) add('bundler', 'Rspack', file.relativePath, config.hash, 'Configuração Rspack encontrada.', 85)
      if (/^playwright\.config\./.test(baseName)) add('test', 'Playwright', file.relativePath, config.hash, 'Configuração Playwright encontrada.', 85)
      if (/^vitest\.config\./.test(baseName)) add('test', 'Vitest', file.relativePath, config.hash, 'Configuração Vitest encontrada.', 85)
      if (/^jest\.config\./.test(baseName)) add('test', 'Jest', file.relativePath, config.hash, 'Configuração Jest encontrada.', 85)
      if (/^(?:eslint\.config\.|\.eslintrc)/.test(baseName)) add('lint', 'ESLint', file.relativePath, config.hash, 'Configuração ESLint encontrada.', 85)
    }

    for (const file of discovery.files) {
      assertNotCancelled(signal)
      const language = languageForFile(file)
      if (!language || evidence.some((item) => item.category === 'language' && item.value === language)) continue
      const content = await readConfig(file.relativePath)
      if (content) add('language', language, file.relativePath, content.hash, `Extensão ${file.extension || 'sem extensão'} encontrada em arquivo de código.`, 65)
    }

    for (const convention of ['src/', 'app/', 'tests/', '__tests__/', '.github/workflows/']) {
      assertNotCancelled(signal)
      const file = discovery.files.find((item) => item.relativePath.startsWith(convention))
      if (file) {
        const content = await readConfig(file.relativePath)
        if (content) add('convention', convention, file.relativePath, content.hash, `Convenção de diretório ${convention} encontrada.`, 60)
      }
    }

    const languageEvidence = evidence.filter((item) => item.category === 'language')
    const primaryLanguage = languageEvidence[0]?.value ?? 'Desconhecida'
    const stack = [...new Set(evidence.filter((item) => ['runtime', 'framework', 'bundler', 'package-manager', 'typecheck', 'lint', 'test', 'build'].includes(item.category)).map((item) => item.value))]
    return {
      name: path.basename(workspace),
      stack,
      primaryLanguage,
      commands,
      evidence,
      detectedAt: new Date().toISOString(),
    }

    async function addPackageManager(value: string, file: DiscoveredFile) {
      const content = await readConfig(file.relativePath)
      if (content) add('package-manager', value, file.relativePath, content.hash, `Arquivo de lock ${file.relativePath} encontrado.`, 95)
    }
  }
}

function assertNotCancelled(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new Error('Indexação cancelada.')
}

function findFile(files: ReadonlyMap<string, DiscoveredFile>, name: string) {
  return [...files.values()].find((file) => path.basename(file.relativePath).toLowerCase() === name)
}

function parsePackage(content: string) {
  try {
    const parsed = JSON.parse(content) as PackageMetadata
    return {
      dependencies: stringRecord(parsed.dependencies),
      devDependencies: stringRecord(parsed.devDependencies),
      peerDependencies: stringRecord(parsed.peerDependencies),
      scripts: stringRecord(parsed.scripts),
    }
  } catch {
    return { dependencies: {}, devDependencies: {}, peerDependencies: {}, scripts: {} }
  }
}

function stringRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === 'string')) as Record<string, string>
}

function languageForFile(file: DiscoveredFile) {
  const extensionMap: Record<string, string> = {
    '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
    '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
    '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin',
    '.c': 'C', '.h': 'C/C++', '.cc': 'C++', '.cpp': 'C++', '.hpp': 'C++', '.cs': 'C#',
    '.swift': 'Swift', '.rb': 'Ruby', '.php': 'PHP', '.ex': 'Elixir', '.exs': 'Elixir', '.lua': 'Lua',
  }
  return extensionMap[file.extension] ?? (file.classification === 'source' ? 'Código' : null)
}

function hashBuffer(content: Buffer) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function stableEvidenceId(workspace: string, category: string, value: string, sourcePath: string, sourceHash: string, reason: string) {
  return `evidence-${crypto.createHash('sha256').update(`${workspace}\0${category}\0${value}\0${sourcePath}\0${sourceHash}\0${reason}`).digest('hex').slice(0, 32)}`
}

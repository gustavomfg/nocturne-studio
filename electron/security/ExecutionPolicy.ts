import path from 'node:path'
import fs from 'node:fs'
import { WORKSPACE_READ_LIMITS } from '../../shared/constants'

export type CommandRisk = 'safe' | 'sensitive' | 'dangerous'
export interface CommandAssessment { risk: CommandRisk; reasons: string[]; requiresApproval: boolean; blockedAutomatic: boolean }

const dangerousPrograms = new Set(['sudo', 'doas', 'su'])
const destructiveGit = new Set(['push', 'clean', 'reset'])

const commonExternalOpenRiskExtensions = new Set([
  '.appimage', '.bat', '.bin', '.com', '.deb', '.dmg', '.exe', '.msi', '.pkg', '.rpm',
  '.sh', '.bash', '.zsh', '.fish', '.csh', '.ksh',
  '.js', '.jse', '.mjs', '.vbs', '.vbe', '.wsf', '.wsh', '.hta', '.ps1', '.psm1',
  '.inetloc', '.url', '.webloc', '.website',
])

const MAX_WORKSPACE_READ_BYTES = Math.max(...Object.values(WORKSPACE_READ_LIMITS))

export const externalOpenRiskExtensionsByPlatform: Record<string, ReadonlySet<string>> = {
  win32: new Set([...commonExternalOpenRiskExtensions, '.appx', '.appxbundle', '.cmd', '.cpl', '.lnk', '.msix', '.msixbundle', '.pif', '.scr', '.scf', '.url', '.website']),
  darwin: new Set([...commonExternalOpenRiskExtensions, '.app', '.command', '.inetloc', '.scpt', '.webloc', '.workflow']),
  linux: new Set([...commonExternalOpenRiskExtensions, '.desktop', '.run']),
  freebsd: new Set([...commonExternalOpenRiskExtensions, '.desktop', '.run']),
  openbsd: new Set([...commonExternalOpenRiskExtensions, '.desktop', '.run']),
  sunos: new Set([...commonExternalOpenRiskExtensions, '.desktop', '.run']),
}

export function isExternalOpenBlocked(filePath: string, platform: NodeJS.Platform = process.platform) {
  const extensions = externalOpenRiskExtensionsByPlatform[platform] ?? commonExternalOpenRiskExtensions
  return extensions.has(path.extname(filePath).toLowerCase())
}

export function assessCommand(command: string | string[]): CommandAssessment {
  const tokens = Array.isArray(command) ? command : tokenize(command)
  const normalized = tokens.map((token) => token.toLowerCase())
  const reasons: string[] = []
  let risk: CommandRisk = 'safe'
  if (normalized.some((token) => dangerousPrograms.has(path.basename(token)))) reasons.push('Elevação de privilégios')
  const gitIndex = normalized.findIndex((token) => path.basename(token) === 'git')
  if (gitIndex >= 0 && destructiveGit.has(normalized[gitIndex + 1])) reasons.push(`Operação Git sensível: ${normalized[gitIndex + 1]}`)
  if (normalized.some((token) => path.basename(token) === 'rm') && normalized.some((token) => /^-[a-z]*r[a-z]*f|^-[a-z]*f[a-z]*r/.test(token))) reasons.push('Remoção recursiva forçada')
  if (normalized.some((token) => ['mkfs', 'shutdown', 'reboot'].includes(path.basename(token)))) reasons.push('Comando destrutivo do sistema')
  if (normalized.some((token) => ['electron-rebuild', 'electron-builder'].includes(path.basename(token))) || normalized.some((token, index) => token === 'npm' && ['rebuild', 'package'].includes(normalized[index + 1])) || normalized.some((token) => ['rebuild:native', 'package'].includes(token))) reasons.push('Pode substituir módulos nativos enquanto o aplicativo está em execução')
  if (reasons.length) risk = 'dangerous'
  else if (normalized.some((token) => ['rm', 'mv', 'chmod', 'chown'].includes(path.basename(token))) || gitIndex >= 0) risk = 'sensitive'
  return { risk, reasons, requiresApproval: risk !== 'safe', blockedAutomatic: risk === 'dangerous' }
}

const DEVICE_PATH_PREFIX = /^\\\\[?.]\\|^\/\//i

export function resolveInsideWorkspace(candidate: string, workspace: string) {
  if (typeof candidate !== 'string' || candidate.includes('\0')) {
    throw new Error('Acesso bloqueado: caminho inválido.')
  }
  if (DEVICE_PATH_PREFIX.test(candidate) || DEVICE_PATH_PREFIX.test(workspace)) {
    throw new Error('Acesso bloqueado: caminhos de dispositivo não são permitidos.')
  }
  const root = path.resolve(workspace)
  const resolved = path.resolve(root, candidate)
  assertContained(resolved, root)
  const realRoot = fs.realpathSync.native(root)
  let existing = resolved
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) break
    existing = parent
  }
  const realExisting = fs.realpathSync.native(existing)
  assertContained(realExisting, realRoot)
  const canonicalResolved = path.resolve(realExisting, path.relative(existing, resolved))
  assertContained(canonicalResolved, realRoot)
  return canonicalResolved
}

export function resolveExistingWorkspacePath(candidate: string, workspace: string) {
  const resolved = resolveInsideWorkspace(candidate, workspace)
  const stat = fs.statSync(resolved)
  if (!stat.isFile() && !stat.isDirectory()) throw new Error('O caminho não é um arquivo ou diretório válido.')
  return resolved
}

export async function statWorkspaceFile(candidate: string, workspace: string) {
  const opened = await openWorkspaceFile(candidate, workspace)
  try {
    return { path: opened.path, stat: opened.stat }
  } finally {
    await opened.handle.close()
  }
}

export async function readWorkspaceFile(candidate: string, workspace: string, maxBytes: number) {
  assertReadLimit(maxBytes)
  const opened = await openWorkspaceFile(candidate, workspace)
  try {
    if (opened.stat.size > maxBytes) throw workspaceFileTooLargeError()

    // Read at most maxBytes + 1 bytes. The extra byte detects a file that
    // grows after the initial descriptor stat without allocating from the
    // file's untrusted size.
    const buffer = Buffer.alloc(maxBytes + 1)
    let offset = 0
    while (offset < buffer.length) {
      const result = await opened.handle.read(buffer, offset, buffer.length - offset, null)
      if (result.bytesRead === 0) break
      offset += result.bytesRead
    }
    const finalStat = await opened.handle.stat()
    if (offset > maxBytes || finalStat.size > maxBytes) throw workspaceFileTooLargeError()
    return { path: opened.path, stat: finalStat, content: buffer.subarray(0, offset) }
  } finally {
    await opened.handle.close()
  }
}

export function isWorkspaceFileTooLarge(error: unknown) {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'EFBIG'
}

export function sanitizeWorkspaceReadError(error: unknown, fallback: string) {
  if (error instanceof Error && (
    error.message.startsWith('Acesso bloqueado:')
    || error.message === 'O caminho não é um arquivo regular.'
    || error.message === 'O arquivo mudou durante a validação.'
  )) return error
  return new Error(fallback)
}

async function openWorkspaceFile(candidate: string, workspace: string) {
  const resolved = resolveInsideWorkspace(candidate, workspace)
  const expected = await fs.promises.stat(resolved)
  if (!expected.isFile()) throw new Error('O caminho não é um arquivo regular.')

  // Re-check the canonical path immediately before opening. The descriptor
  // identity check below closes the remaining validation/open race window on
  // platforms where O_NOFOLLOW is unavailable.
  const realRoot = await fs.promises.realpath(path.resolve(workspace))
  const realResolved = await fs.promises.realpath(resolved)
  assertContained(realResolved, realRoot)

  const handle = await fs.promises.open(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    const stat = await handle.stat()
    if (!stat.isFile()) throw new Error('O caminho não é um arquivo regular.')
    if (!sameFileIdentity(expected, stat)) throw new Error('O arquivo mudou durante a validação.')
    return { path: resolved, stat, handle }
  } catch (error) {
    await handle.close().catch(() => undefined)
    throw error
  }
}

function assertReadLimit(maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_WORKSPACE_READ_BYTES) throw new Error('Limite de leitura inválido.')
}

function workspaceFileTooLargeError() {
  const error = new Error('O arquivo excede o limite permitido.') as NodeJS.ErrnoException
  error.code = 'EFBIG'
  return error
}

function sameFileIdentity(expected: fs.Stats, actual: fs.Stats) {
  const identityAvailable = Number.isFinite(expected.dev) && Number.isFinite(expected.ino)
    && Number.isFinite(actual.dev) && Number.isFinite(actual.ino)
    && (expected.dev !== 0 || expected.ino !== 0)
  return !identityAvailable || (expected.dev === actual.dev && expected.ino === actual.ino)
}

function assertContained(candidate: string, root: string) {
  const relative = path.relative(root, candidate)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Acesso bloqueado: o caminho está fora do workspace.')
  }
}

function tokenize(command: string) {
  return command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((token) => token.replace(/^(['"])(.*)\1$/, '$2')) ?? []
}

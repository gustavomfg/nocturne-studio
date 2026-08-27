import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { WorkspaceAvailability } from '../../shared/types'

const DEVICE_PATH_PREFIX = /^\\\\[?.]\\|^\/\//i

const systemRoots = process.platform === 'win32'
  ? [process.env.SystemRoot, process.env.ProgramFiles, process.env['ProgramFiles(x86)']]
  : ['/bin', '/boot', '/dev', '/etc', '/proc', '/run', '/sbin', '/sys', '/usr', '/var']

export interface WorkspaceInspection {
  availability: WorkspaceAvailability
  path: string | null
  message?: string
}

function isBlocked(candidate: string) {
  return isBlockedWorkspacePath(candidate, [path.parse(candidate).root, os.homedir(), ...systemRoots])
}

export function isBlockedWorkspacePath(candidate: string, roots: readonly (string | undefined)[]) {
  const canonicalCandidate = canonicalizeExistingPath(candidate)
  const blocked = roots
    .filter((entry): entry is string => Boolean(entry))
    .map(canonicalizeExistingPath)
  return blocked.includes(canonicalCandidate)
}

function canonicalizeExistingPath(value: string) {
  const resolved = path.resolve(value)
  try {
    return fs.realpathSync.native(resolved)
  } catch {
    // Missing paths cannot be realpathed yet; keep their normalized lexical form.
    return resolved
  }
}

function unavailable(availability: Exclude<WorkspaceAvailability, 'available'>, candidate: string | null, message: string): WorkspaceInspection {
  return { availability, path: candidate, message }
}

export function inspectWorkspaceScope(value: string): WorkspaceInspection {
  if (typeof value !== 'string' || value.includes('\0') || DEVICE_PATH_PREFIX.test(value)) {
    return unavailable('invalid', null, 'Caminho de workspace inválido.')
  }

  const resolved = path.resolve(value)
  if (isBlocked(resolved)) {
    return unavailable('invalid', resolved, 'Selecione uma pasta de projeto específica; raízes amplas e diretórios do sistema não são permitidos.')
  }

  try {
    if (!fs.statSync(resolved).isDirectory()) {
      return unavailable('invalid', resolved, 'O caminho do workspace não é uma pasta.')
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return unavailable('missing', resolved, 'Pasta do projeto não encontrada.')
    if (code === 'EACCES' || code === 'EPERM') return unavailable('permission-denied', resolved, 'Sem permissão para acessar a pasta do projeto.')
    return unavailable('invalid', resolved, 'Não foi possível validar a pasta do projeto.')
  }

  let candidate: string
  try {
    candidate = fs.realpathSync.native(resolved)
    fs.accessSync(candidate, fs.constants.R_OK | fs.constants.X_OK)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EACCES' || code === 'EPERM') return unavailable('permission-denied', resolved, 'Sem permissão para acessar a pasta do projeto.')
    if (code === 'ENOENT' || code === 'ENOTDIR') return unavailable('missing', resolved, 'Pasta do projeto não encontrada.')
    return unavailable('invalid', resolved, 'Não foi possível validar a pasta do projeto.')
  }

  if (isBlocked(candidate)) {
    return unavailable('invalid', candidate, 'Selecione uma pasta de projeto específica; raízes amplas e diretórios do sistema não são permitidos.')
  }
  return { availability: 'available', path: candidate }
}

export function assertSafeWorkspaceScope(value: string, requireExisting = true) {
  const inspection = inspectWorkspaceScope(value)
  if (inspection.availability === 'available') return inspection.path as string
  if (!requireExisting && inspection.availability === 'missing' && inspection.path) return inspection.path
  throw new Error(inspection.message)
}

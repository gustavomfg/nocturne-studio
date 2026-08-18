import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { resolveInsideWorkspace } from '../security/ExecutionPolicy'

const execFileAsync = promisify(execFile)

export interface BuildRollbackStatus {
  available: boolean
  files: string[]
  createdAt?: string
  reason?: string
}

interface Snapshot extends BuildRollbackStatus {
  workspace: string
}

type CommandRunner = (
  args: string[],
  cwd: string,
) => Promise<{ stdout: string; stderr: string }>

export class BuildRollbackService {
  private readonly active = new Map<string, Snapshot>()
  private readonly completed = new Map<string, Snapshot>()

  constructor(
    private readonly run: CommandRunner = (args, cwd) => execFileAsync(
      'git',
      args,
      { cwd, encoding: 'utf8', timeout: 20_000, maxBuffer: 5_000_000 },
    ),
  ) {}

  async begin(conversationId: string, workspace: string) {
    let normalizedWorkspace = workspace
    let snapshot: Snapshot
    try {
      normalizedWorkspace = resolveInsideWorkspace('.', workspace)
      await this.run(['rev-parse', '--verify', 'HEAD'], normalizedWorkspace)
      const status = await this.run(
        ['status', '--porcelain=v1', '--untracked-files=all', '--', '.'],
        normalizedWorkspace,
      )
      snapshot = status.stdout.trim()
        ? {
          workspace: normalizedWorkspace,
          available: false,
          files: [],
          reason: 'Rollback indisponível: o workspace já possuía alterações antes deste Build.',
        }
        : { workspace: normalizedWorkspace, available: true, files: [] }
    } catch {
      snapshot = {
        workspace: normalizedWorkspace,
        available: false,
        files: [],
        reason: 'Rollback indisponível: o workspace não possui um repositório Git utilizável.',
      }
    }
    this.active.set(conversationId, snapshot)
    return publicStatus(snapshot)
  }

  abort(conversationId: string) {
    this.active.delete(conversationId)
  }

  complete(conversationId: string, files: string[]) {
    const snapshot = this.active.get(conversationId)
    this.active.delete(conversationId)
    if (!snapshot) return
    const normalized: string[] = []
    for (const file of files) {
      try {
        const resolved = resolveInsideWorkspace(file, snapshot.workspace)
        const relative = path.relative(snapshot.workspace, resolved)
        if (relative && !normalized.includes(relative)) normalized.push(relative)
      } catch {
        snapshot.available = false
        snapshot.reason = 'Rollback indisponível: a execução reportou um caminho fora do workspace.'
      }
    }
    snapshot.files = normalized.slice(0, 300)
    snapshot.createdAt = new Date().toISOString()
    if (!snapshot.files.length) {
      snapshot.available = false
      snapshot.reason ??= 'Nenhum arquivo alterado foi reportado para este Build.'
    }
    this.completed.set(conversationId, snapshot)
  }

  status(conversationId: string): BuildRollbackStatus {
    const snapshot = this.completed.get(conversationId) ?? this.active.get(conversationId)
    return snapshot
      ? publicStatus(snapshot)
      : { available: false, files: [], reason: 'Nenhum Build reversível foi registrado nesta conversa.' }
  }

  async rollback(conversationId: string, workspace: string) {
    const snapshot = this.completed.get(conversationId)
    const normalizedWorkspace = snapshot?.available ? resolveInsideWorkspace('.', workspace) : workspace
    if (!snapshot || !snapshot.available || snapshot.workspace !== normalizedWorkspace) {
      throw new Error(snapshot?.reason ?? 'Nenhum Build reversível foi registrado nesta conversa.')
    }

    const tracked: string[] = []
    const created: Array<{ relative: string; absolute: string }> = []
    let currentPath = ''
    try {
      for (const relative of snapshot.files) {
        currentPath = relative
        const absolute = resolveInsideWorkspace(relative, normalizedWorkspace)
        try {
          await this.run(['ls-files', '--error-unmatch', '--', relative], normalizedWorkspace)
          tracked.push(relative)
        } catch {
          const stat = await fs.promises.lstat(absolute).catch(() => null)
          if (!stat) continue
          if (!stat.isFile() && !stat.isSymbolicLink()) {
            throw new Error('o caminho criado não é um arquivo regular')
          }
          created.push({ relative, absolute })
        }
      }
      if (tracked.length) {
        currentPath = tracked.join(', ')
        await this.run(['restore', '--source=HEAD', '--staged', '--worktree', '--', ...tracked], normalizedWorkspace)
      }
      for (const file of created) {
        currentPath = file.relative
        await fs.promises.unlink(file.absolute)
      }
    } catch (error) {
      throw new Error(`Rollback falhou em ${currentPath || 'um caminho desconhecido'}: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.completed.delete(conversationId)
    return { restored: [...tracked, ...created.map((file) => file.relative)] }
  }
}

function publicStatus(snapshot: Snapshot): BuildRollbackStatus {
  return {
    available: snapshot.available,
    files: [...snapshot.files],
    createdAt: snapshot.createdAt,
    reason: snapshot.reason,
  }
}

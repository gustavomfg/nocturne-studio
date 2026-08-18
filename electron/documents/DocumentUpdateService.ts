import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { WORKSPACE_READ_LIMITS } from '../../shared/constants'
import { readWorkspaceFile, resolveInsideWorkspace } from '../security/ExecutionPolicy'

const MAX_DOCUMENT_BYTES = WORKSPACE_READ_LIMITS.documentBytes

export type DocumentUpdateStrategy = 'append' | 'replace'

export interface DocumentUpdatePreview {
  target: string
  name: string
  existing: string
  generated: string
  expectedHash: string | null
}

export class DocumentUpdateService {
  async preview(workspace: string, target: string, generated: string): Promise<DocumentUpdatePreview> {
    const resolved = resolveDocumentTarget(workspace, target)
    const existing = await readWorkspaceFile(resolved, workspace, MAX_DOCUMENT_BYTES).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      if (error.code === 'EFBIG') throw new Error('Documentação existente excede o limite de 2 MB.')
      throw error
    })
    const existingContent = existing?.content.toString('utf8') ?? ''
    return {
      target: existing?.path ?? resolved,
      name: path.basename(resolved),
      existing: existingContent,
      generated,
      expectedHash: existing ? digest(existingContent) : null,
    }
  }

  async apply(
    workspace: string,
    target: string,
    generated: string,
    strategy: DocumentUpdateStrategy,
    expectedHash: string | null,
  ) {
    const current = await this.preview(workspace, target, generated)
    if (current.expectedHash !== expectedHash) {
      throw new Error('O documento mudou depois do preview. Gere uma nova comparação antes de aplicar.')
    }
    const content = mergeMarkdown(current.existing, generated, strategy)
    const temporary = `${current.target}.tmp-${process.pid}-${randomUUID()}`
    let handle: fs.promises.FileHandle | null = null
    try {
      handle = await fs.promises.open(temporary, 'wx', 0o600)
      await handle.writeFile(content, 'utf8')
      await handle.sync()
      await handle.close()
      handle = null
      await fs.promises.rename(temporary, current.target)
      await fs.promises.chmod(current.target, 0o600)
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await fs.promises.unlink(temporary).catch(() => undefined)
      throw error
    }
    return { target: current.target, content, strategy }
  }
}

export function mergeMarkdown(existing: string, generated: string, strategy: DocumentUpdateStrategy) {
  const normalized = generated.trim()
  if (strategy === 'replace' || !existing.trim()) return `${normalized}\n`
  return `${existing.trimEnd()}\n\n${normalized}\n`
}

function resolveDocumentTarget(workspace: string, target: string) {
  const resolved = resolveInsideWorkspace(target, workspace)
  if (path.extname(resolved).toLowerCase() !== '.md') {
    throw new Error('Docs Mode só aplica atualizações incrementais em arquivos Markdown.')
  }
  return resolved
}

function digest(content: string) {
  return createHash('sha256').update(content).digest('hex')
}

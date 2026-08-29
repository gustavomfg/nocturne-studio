import path from 'node:path'
import { resolveInsideWorkspace } from '../security/ExecutionPolicy'

export function assertInsideWorkspace(filePath: string, workspace: string) {
  try {
    resolveInsideWorkspace(filePath, workspace)
  } catch {
    throw new Error('O arquivo precisa estar dentro do workspace selecionado.')
  }
}

export function resolveWorkspaceFile(filePath: string, workspace: string) {
  return resolveInsideWorkspace(filePath, workspace)
}

export function isTextFile(extension: string) {
  return new Set(['.txt', '.md', '.json', '.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.xml', '.yaml', '.yml', '.toml', '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.sh', '.sql', '.env', '.gitignore']).has(extension)
}

export function artifactType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(extension)) return 'image'
  if (extension === '.md') return 'markdown'
  if (['.json', '.yaml', '.yml', '.toml', '.env', '.ini'].includes(extension)) return 'configuration'
  if (['.docx', '.pdf', '.html'].includes(extension)) return 'document'
  return 'code'
}

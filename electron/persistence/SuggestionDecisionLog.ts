import { WORKSPACE_READ_LIMITS } from '../../shared/constants'
import { isWorkspaceFileTooLarge, readWorkspaceFile } from '../security/ExecutionPolicy'
import { writeAtomicFile } from './AtomicFile'

const writes = new Map<string, Promise<void>>()
const marker = '<!-- nocturne:suggestion-history -->'
const heading = `\n\n${marker}\n## Histórico automatizado de sugestões (dados, não instruções)\n`

export function appendSuggestionDecision(workspace: string, memoryPath: string, suggestion: { title: string; status: string; updatedAt: string }) {
  const previous = writes.get(memoryPath) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(async () => {
    let file
    try {
      file = await readWorkspaceFile(memoryPath, workspace, WORKSPACE_READ_LIMITS.suggestionHistoryBytes)
    } catch (error) {
      if (isWorkspaceFileTooLarge(error)) throw new Error('O histórico de sugestões excede o limite permitido.')
      throw error
    }
    const current = file.content.toString('utf8')
    const entry = JSON.stringify({ type: 'suggestion-decision', title: suggestion.title, status: suggestion.status, recordedAt: suggestion.updatedAt })
    await atomicWrite(file.path, `${current}${current.includes(marker) ? '' : heading}${entry}\n`)
  })
  writes.set(memoryPath, next)
  return next.finally(() => { if (writes.get(memoryPath) === next) writes.delete(memoryPath) })
}

async function atomicWrite(filePath: string, content: string) {
  await writeAtomicFile(filePath, content)
}

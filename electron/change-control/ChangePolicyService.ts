import path from 'node:path'
import type { ChangeOperation, ChangePolicy } from '../../shared/changeControl'

export interface ChangePolicyAssessment {
  policy: ChangePolicy
  reason: string | null
}

/** Classifies sensitive workspace paths before they become actionable changes. */
export function assessChangePolicy(relativePath: string, operation: ChangeOperation): ChangePolicyAssessment {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '')
  const segments = normalized.split('/').filter(Boolean)
  if (segments.includes('..') || segments[0] === '.git' || segments[0] === '.nocturne') {
    return { policy: 'blocked', reason: 'O caminho pertence à área protegida do workspace.' }
  }
  const basename = path.posix.basename(normalized).toLowerCase()
  if (operation === 'delete' || operation === 'rename') {
    return { policy: 'requires-approval', reason: 'Remoções e renomeações exigem aprovação explícita.' }
  }
  if (basename === '.env' || basename.startsWith('.env.')) {
    return { policy: 'requires-approval', reason: 'Arquivos de ambiente podem conter segredos e exigem aprovação explícita.' }
  }
  return { policy: 'allowed', reason: null }
}

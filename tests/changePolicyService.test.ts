import { describe, expect, it } from 'vitest'
import { assessChangePolicy } from '../electron/change-control/ChangePolicyService'

describe('ChangePolicyService', () => {
  it('protege áreas internas e exige confirmação para mutações sensíveis', () => {
    expect(assessChangePolicy('.git/config', 'modify')).toEqual({ policy: 'blocked', reason: expect.any(String) })
    expect(assessChangePolicy('.nocturne/project.json', 'create').policy).toBe('blocked')
    expect(assessChangePolicy('.env', 'modify').policy).toBe('requires-approval')
    expect(assessChangePolicy('src/old.ts', 'delete').policy).toBe('requires-approval')
    expect(assessChangePolicy('src/App.tsx', 'modify')).toEqual({ policy: 'allowed', reason: null })
  })
})

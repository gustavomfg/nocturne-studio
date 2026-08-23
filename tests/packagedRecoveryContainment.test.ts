import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canonicalizePackagedRecoveryPath, isPackagedRecoveryPathInside } from '../electron/security/PackagedRecoveryContainment'
import { removeTestDirectory } from './helpers/platform'

describe('containment do recovery empacotado', () => {
  let root: string
  let outside: string

  beforeAll(() => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-recovery-containment-')))
    outside = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-recovery-outside-')))
  })

  afterAll(() => {
    removeTestDirectory(root)
    removeTestDirectory(outside)
  })

  it('trata aliases físicos como a mesma raiz e aceita filhos futuros', () => {
    const lexicalRoot = path.join(path.resolve(os.tmpdir()), path.basename(root))
    const lexicalChild = path.join(lexicalRoot, 'future', 'report.json')
    const canonicalRoot = canonicalizePackagedRecoveryPath(lexicalRoot)
    const canonicalChild = canonicalizePackagedRecoveryPath(lexicalChild)

    expect(canonicalRoot).toBeTruthy()
    expect(canonicalChild).toBe(path.join(canonicalRoot as string, 'future', 'report.json'))
    expect(isPackagedRecoveryPathInside(lexicalRoot, lexicalChild)).toBe(true)
    expect(isPackagedRecoveryPathInside(lexicalRoot, lexicalRoot)).toBe(true)
  })

  it('rejeita traversal e sibling com prefixo coincidente', () => {
    expect(isPackagedRecoveryPathInside(root, path.join(root, '..', path.basename(outside)))).toBe(false)
    expect(isPackagedRecoveryPathInside(root, `${root}-evil`)).toBe(false)
  })

  it('rejeita symlink que aponta para fora da raiz', () => {
    const link = path.join(root, 'external-link')
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    try {
      expect(isPackagedRecoveryPathInside(root, path.join(link, 'secret.json'))).toBe(false)
    } finally {
      fs.rmSync(link, { recursive: true, force: true })
    }
  })
})

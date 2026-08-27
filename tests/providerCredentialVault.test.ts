import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ProviderCredentialVault,
  ProviderCredentialVaultError,
  type CredentialEncryption,
} from '../electron/security/ProviderCredentialVault'
import { expectUserOnlyMode } from './helpers/platform'

const references = [
  '9ba7e635-8746-48bd-a8e9-4609ff1690cb',
  'f79c1a83-df07-4ff0-91d0-cf639fd0845e',
  'c8c57256-39b7-4366-988c-b0b261ee62c2',
]

class FakeEncryption implements CredentialEncryption {
  available = true
  failEncryption = false
  failDecryption = false

  isSecureStorageAvailable() {
    return this.available
  }

  encrypt(secret: string) {
    if (this.failEncryption) throw new Error(`encrypt failed: ${secret}`)
    return xor(Buffer.from(secret, 'utf8'))
  }

  decrypt(ciphertext: Buffer) {
    if (this.failDecryption) throw new Error('decrypt failed')
    return xor(ciphertext).toString('utf8')
  }
}

function xor(input: Buffer) {
  const output = Buffer.alloc(input.length)
  for (const [index, value] of input.entries()) output[index] = value ^ 0xaa
  return output
}

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (directory) => fs.promises.rm(directory, { recursive: true, force: true }),
  ))
})

async function temporaryDirectory() {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'nocturne-provider-vault-'),
  )
  temporaryDirectories.push(directory)
  return directory
}

async function setup(options: {
  encryption?: FakeEncryption
  generatedReferences?: string[]
} = {}) {
  const directory = await temporaryDirectory()
  const encryption = options.encryption ?? new FakeEncryption()
  const generated = [...(options.generatedReferences ?? references)]
  const vault = new ProviderCredentialVault(
    directory,
    encryption,
    () => generated.shift() ?? references[0],
  )
  return { directory, encryption, vault }
}

describe('ProviderCredentialVault', () => {
  it('persiste somente ciphertext com permissões restritas e referência opaca', async () => {
    const { vault } = await setup()
    const reference = await vault.create('sk-segredo-super-secreto')

    expect(reference).toBe(references[0])
    await expect(vault.resolve(reference)).resolves.toBe('sk-segredo-super-secreto')
    await expect(vault.has(reference)).resolves.toBe(true)

    const content = await fs.promises.readFile(vault.filePath, 'utf8')
    expect(content).not.toContain('sk-segredo-super-secreto')
    expect(JSON.parse(content)).toMatchObject({
      version: 1,
      entries: { [reference]: expect.any(String) },
    })
    const mode = (await fs.promises.stat(vault.filePath)).mode & 0o777
    expectUserOnlyMode(mode)
  })

  it('recusa persistência quando o sistema não oferece proteção segura', async () => {
    const encryption = new FakeEncryption()
    encryption.available = false
    const { vault } = await setup({ encryption })

    await expect(vault.create('não-persistir')).rejects.toMatchObject({
      code: 'secure-storage-unavailable',
    })
    await expect(fs.promises.stat(vault.filePath)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('substitui e remove uma credencial sem alterar sua referência', async () => {
    const { vault } = await setup()
    const reference = await vault.create('primeira-chave')
    await vault.replace(reference, 'segunda-chave')

    await expect(vault.resolve(reference)).resolves.toBe('segunda-chave')
    await expect(vault.delete(reference)).resolves.toBe(true)
    await expect(vault.delete(reference)).resolves.toBe(false)
    await expect(vault.resolve(reference)).resolves.toBeUndefined()
  })

  it('serializa gravações concorrentes sem perder entradas', async () => {
    const { vault } = await setup()
    const created = await Promise.all([
      vault.create('chave-um'),
      vault.create('chave-dois'),
      vault.create('chave-três'),
    ])

    expect(created).toEqual(references)
    await expect(Promise.all(created.map((reference) => vault.has(reference)))).resolves
      .toEqual([true, true, true])
    const persisted = JSON.parse(
      await fs.promises.readFile(vault.filePath, 'utf8'),
    ) as { entries: Record<string, string> }
    expect(Object.keys(persisted.entries)).toHaveLength(3)
  })

  it('não sobrescreve um cofre corrompido ou um symlink', async () => {
    const corrupt = await setup()
    await fs.promises.writeFile(corrupt.vault.filePath, '{"version":1,"entries":"invalid"}')
    const before = await fs.promises.readFile(corrupt.vault.filePath, 'utf8')
    await expect(corrupt.vault.create('nova-chave')).rejects.toMatchObject({
      code: 'corrupt-store',
    })
    await expect(fs.promises.readFile(corrupt.vault.filePath, 'utf8')).resolves.toBe(before)

    const linked = await setup()
    const outside = path.join(linked.directory, 'outside.json')
    await fs.promises.writeFile(outside, '{"version":1,"entries":{}}')
    await fs.promises.symlink(outside, linked.vault.filePath)
    await expect(linked.vault.create('nova-chave')).rejects.toMatchObject({
      code: 'corrupt-store',
    })
  })

  it('não trata como cofre novo uma remoção depois da abertura', async () => {
    const { vault } = await setup()
    const reference = await vault.create('credencial-preservada')
    const originalLstat = fs.promises.lstat.bind(fs.promises)
    let injected = false
    const lstat = vi.spyOn(fs.promises, 'lstat').mockImplementation(async (filePath) => {
      if (!injected && filePath === vault.filePath) {
        injected = true
        await fs.promises.rename(vault.filePath, `${vault.filePath}.moved`)
      }
      return originalLstat(filePath)
    })

    try {
      await expect(vault.resolve(reference)).rejects.toMatchObject({ code: 'corrupt-store' })
      await expect(fs.promises.stat(`${vault.filePath}.moved`)).resolves.toBeDefined()
    } finally {
      lstat.mockRestore()
    }
  })

  it('preserva o ciphertext anterior quando a rotação não pode criptografar', async () => {
    const { encryption, vault } = await setup()
    const reference = await vault.create('chave-válida')
    const before = await fs.promises.readFile(vault.filePath, 'utf8')
    encryption.failEncryption = true

    await expect(vault.replace(reference, 'não-gravar')).rejects.toMatchObject({
      code: 'encryption-failed',
    })
    await expect(fs.promises.readFile(vault.filePath, 'utf8')).resolves.toBe(before)
    encryption.failEncryption = false
    await expect(vault.resolve(reference)).resolves.toBe('chave-válida')
  })

  it('normaliza falhas de descriptografia sem expor conteúdo interno', async () => {
    const { encryption, vault } = await setup()
    const reference = await vault.create('segredo-que-não-pode-vazar')
    encryption.failDecryption = true

    await expect(vault.resolve(reference)).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ProviderCredentialVaultError)
      expect(error).toMatchObject({
        code: 'decryption-failed',
        message: expect.not.stringContaining('segredo-que-não-pode-vazar'),
      })
      return true
    })
  })

  it('valida referências e limites antes de acessar o arquivo', async () => {
    const { vault } = await setup()
    await expect(vault.create('')).rejects.toMatchObject({
      code: 'invalid-secret',
    })
    await expect(vault.create('x'.repeat(64_001))).rejects.toMatchObject({
      code: 'invalid-secret',
    })
    await expect(vault.resolve('../credential')).rejects.toMatchObject({
      code: 'invalid-reference',
    })
  })

  it('remove referências órfãs sem descriptografar as credenciais ativas', async () => {
    const { vault } = await setup()
    const active = await vault.create('active-secret')
    const orphan = await vault.create('orphan-secret')

    await expect(vault.prune([active])).resolves.toBe(1)
    await expect(vault.resolve(active)).resolves.toBe('active-secret')
    await expect(vault.has(orphan)).resolves.toBe(false)
    await expect(vault.prune([active])).resolves.toBe(0)
  })
})

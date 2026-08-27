import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { PROVIDER_CONFIGURATION_LIMITS } from '../../shared/ai/providerConfiguration'

const STORE_VERSION = 1
const CREDENTIAL_FILE = 'provider-credentials.json'
const ENCRYPTED_CHARACTERS = 256_000

const referenceSchema = z.string().uuid()
const storeSchema = z.object({
  version: z.literal(STORE_VERSION),
  entries: z.record(
    referenceSchema,
    z.string().min(1).max(ENCRYPTED_CHARACTERS).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  ),
}).strict()

interface CredentialStore {
  version: typeof STORE_VERSION
  entries: Record<string, string>
}

export interface CredentialEncryption {
  isSecureStorageAvailable(): boolean
  encrypt(secret: string): Buffer
  decrypt(ciphertext: Buffer): string
}

export type ProviderCredentialVaultErrorCode =
  | 'secure-storage-unavailable'
  | 'invalid-reference'
  | 'invalid-secret'
  | 'corrupt-store'
  | 'encryption-failed'
  | 'decryption-failed'

export class ProviderCredentialVaultError extends Error {
  constructor(
    readonly code: ProviderCredentialVaultErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderCredentialVaultError'
  }
}

export class ProviderCredentialVault {
  readonly filePath: string
  private operation: Promise<void> = Promise.resolve()

  constructor(
    userDataPath: string,
    private readonly encryption: CredentialEncryption,
    private readonly createReference: () => string = randomUUID,
  ) {
    this.filePath = path.join(userDataPath, CREDENTIAL_FILE)
  }

  create(secret: string): Promise<string> {
    return this.exclusive(async () => {
      this.assertAvailable()
      const validatedSecret = validateSecret(secret)
      const reference = validateReference(this.createReference())
      const store = await this.readStore()
      if (store.entries[reference]) {
        throw new ProviderCredentialVaultError(
          'invalid-reference',
          'A referência de credencial já existe.',
        )
      }
      store.entries[reference] = this.encrypt(validatedSecret)
      await this.writeStore(store)
      return reference
    })
  }

  replace(reference: string, secret: string): Promise<void> {
    return this.exclusive(async () => {
      this.assertAvailable()
      const validatedReference = validateReference(reference)
      const validatedSecret = validateSecret(secret)
      const store = await this.readStore()
      if (!store.entries[validatedReference]) {
        throw new ProviderCredentialVaultError(
          'invalid-reference',
          'A referência de credencial não existe.',
        )
      }
      store.entries[validatedReference] = this.encrypt(validatedSecret)
      await this.writeStore(store)
    })
  }

  resolve(reference: string): Promise<string | undefined> {
    return this.exclusive(async () => {
      this.assertAvailable()
      const validatedReference = validateReference(reference)
      const store = await this.readStore()
      const encrypted = store.entries[validatedReference]
      if (!encrypted) return undefined
      try {
        return this.encryption.decrypt(Buffer.from(encrypted, 'base64'))
      } catch {
        throw new ProviderCredentialVaultError(
          'decryption-failed',
          'Não foi possível acessar a credencial armazenada.',
        )
      }
    })
  }

  has(reference: string): Promise<boolean> {
    return this.exclusive(async () => {
      this.assertAvailable()
      const validatedReference = validateReference(reference)
      const store = await this.readStore()
      return Boolean(store.entries[validatedReference])
    })
  }

  delete(reference: string): Promise<boolean> {
    return this.exclusive(async () => {
      const validatedReference = validateReference(reference)
      const store = await this.readStore()
      if (!store.entries[validatedReference]) return false
      delete store.entries[validatedReference]
      await this.writeStore(store)
      return true
    })
  }

  prune(allowedReferences: readonly string[]): Promise<number> {
    return this.exclusive(async () => {
      const allowed = new Set(allowedReferences.map(validateReference))
      const store = await this.readStore()
      let removed = 0
      for (const reference of Object.keys(store.entries)) {
        if (allowed.has(reference)) continue
        delete store.entries[reference]
        removed += 1
      }
      if (removed > 0) await this.writeStore(store)
      return removed
    })
  }

  private assertAvailable() {
    if (!this.encryption.isSecureStorageAvailable()) {
      throw new ProviderCredentialVaultError(
        'secure-storage-unavailable',
        'O sistema operacional não oferece armazenamento seguro de credenciais.',
      )
    }
  }

  private encrypt(secret: string) {
    try {
      const encrypted = this.encryption.encrypt(secret)
      if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) throw new Error()
      const value = encrypted.toString('base64')
      if (value.length > ENCRYPTED_CHARACTERS) throw new Error()
      return value
    } catch {
      throw new ProviderCredentialVaultError(
        'encryption-failed',
        'Não foi possível proteger a credencial.',
      )
    }
  }

  private async readStore(): Promise<CredentialStore> {
    let handle: fs.promises.FileHandle | undefined
    try {
      const noFollow = process.platform === 'win32' ? 0 : fs.constants.O_NOFOLLOW
      handle = await fs.promises.open(this.filePath, fs.constants.O_RDONLY | noFollow)
      const opened = await handle.stat()
      if (!opened.isFile()) throw new Error()
      const content = await handle.readFile({ encoding: 'utf8' })
      const current = await fs.promises.lstat(this.filePath)
      if (!current.isFile() || current.isSymbolicLink() || !sameFileIdentity(opened, current)) throw new Error()
      return storeSchema.parse(JSON.parse(content)) as CredentialStore
    } catch (error) {
      if (!handle && isNodeError(error) && error.code === 'ENOENT') {
        return { version: STORE_VERSION, entries: {} }
      }
      throw new ProviderCredentialVaultError(
        'corrupt-store',
        'O cofre de credenciais está inválido ou inacessível.',
      )
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  private async writeStore(store: CredentialStore) {
    const parsed = storeSchema.parse(store)
    const directory = path.dirname(this.filePath)
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = path.join(
      directory,
      `.${path.basename(this.filePath)}.${randomUUID()}.tmp`,
    )
    let handle: fs.promises.FileHandle | undefined
    try {
      handle = await fs.promises.open(temporary, 'wx', 0o600)
      await handle.writeFile(`${JSON.stringify(parsed)}\n`, 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      await fs.promises.chmod(temporary, 0o600)
      await fs.promises.rename(temporary, this.filePath)
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await fs.promises.unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation)
    this.operation = result.then(() => undefined, () => undefined)
    return result
  }
}

function validateReference(value: string) {
  const parsed = referenceSchema.safeParse(value)
  if (!parsed.success) {
    throw new ProviderCredentialVaultError(
      'invalid-reference',
      'A referência de credencial é inválida.',
    )
  }
  return parsed.data
}

function validateSecret(value: string) {
  if (typeof value !== 'string' || value.length === 0 || value.length > PROVIDER_CONFIGURATION_LIMITS.credentialCharacters) {
    throw new ProviderCredentialVaultError(
      'invalid-secret',
      'A credencial possui tamanho inválido.',
    )
  }
  return value
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function sameFileIdentity(left: fs.Stats, right: fs.Stats) {
  return left.dev === right.dev && left.ino === right.ino
}

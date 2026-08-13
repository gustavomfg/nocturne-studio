import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import compatibility from '../../shared/codex-compatibility.json'
import type { CodexAccountStatus } from '../../shared/types'

const execFileAsync = promisify(execFile)

type CommandRunner = (
  args: string[],
  timeout: number,
) => Promise<{ stdout: string; stderr: string }>

export class CodexAccountService {
  constructor(
    private readonly run: CommandRunner = (args, timeout) => execFileAsync(
      'codex',
      args,
      { encoding: 'utf8', timeout, maxBuffer: 64_000 },
    ),
  ) {}

  async status(): Promise<CodexAccountStatus> {
    let versionOutput: string
    try {
      versionOutput = (await this.run(['--version'], 5_000)).stdout
    } catch (error) {
      if (isMissingExecutable(error)) {
        return baseStatus('not-installed')
      }
      return {
        ...baseStatus('internal-error'),
        error: 'Não foi possível verificar a instalação do Codex CLI.',
      }
    }

    const version = versionOutput.match(/\d+\.\d+\.\d+/)?.[0]
    // The CLI is installed and updated outside of Nocturne. Keep the minimum
    // as a safety floor, while the App Server handshake remains the live
    // protocol compatibility gate for newer releases.
    const minimumSatisfied = Boolean(version && compareSemver(version, compatibility.minimum) >= 0)
    const compatible = minimumSatisfied
    const recommended = version === compatibility.recommended
    try {
      const output = await this.run(['login', 'status'], 10_000)
      const authenticationMethod = parseAuthenticationMethod(`${output.stdout}\n${output.stderr}`)
      return {
        ...baseStatus(authenticationMethod ? 'ready' : 'not-authenticated'),
        installed: true,
        authenticated: authenticationMethod !== undefined,
        compatible,
        version,
        minimumSatisfied,
        recommended,
        authenticationMethod,
        state: compatible
          ? (authenticationMethod ? 'ready' : 'not-authenticated')
          : 'incompatible',
      }
    } catch {
      return {
        ...baseStatus(compatible ? 'not-authenticated' : 'incompatible'),
        installed: true,
        authenticated: false,
        compatible,
        version,
        minimumSatisfied,
        recommended,
      }
    }
  }

  async login() {
    const current = await this.status()
    if (!current.installed) {
      throw new Error('Instale o Codex CLI antes de conectar sua conta ChatGPT.')
    }
    if (!current.minimumSatisfied) {
      throw new Error(
        `A versão instalada do Codex CLI está abaixo do mínimo suportado (${compatibility.minimum}). Atualize o Codex CLI e tente novamente.`,
      )
    }
    if (current.authenticated && current.authenticationMethod === 'chatgpt') return current

    try {
      await this.run(['login'], 10 * 60_000)
    } catch {
      throw new Error('O login do Codex não foi concluído. Tente novamente e finalize a autenticação no navegador.')
    }
    const authenticated = await this.status()
    if (!authenticated.authenticated || authenticated.authenticationMethod !== 'chatgpt') {
      throw new Error('O Codex CLI não confirmou uma conta ChatGPT autenticada.')
    }
    return authenticated
  }

  async logout() {
    const current = await this.status()
    if (!current.installed || !current.authenticated) return current
    try {
      await this.run(['logout'], 15_000)
    } catch {
      throw new Error('Não foi possível desconectar a conta do Codex CLI.')
    }
    return this.status()
  }
}

function parseAuthenticationMethod(output: string) {
  if (!/logged in|autenticad[oa]|signed in/i.test(output)) return undefined
  if (/chatgpt/i.test(output)) return 'chatgpt' as const
  if (/api key|api-key/i.test(output)) return 'api-key' as const
  return 'unknown' as const
}

function isMissingExecutable(error: unknown) {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function baseStatus(state: CodexAccountStatus['state']): CodexAccountStatus {
  return {
    state,
    installed: false,
    authenticated: false,
    compatible: false,
    minimumVersion: compatibility.minimum,
    recommendedVersion: compatibility.recommended,
    minimumSatisfied: false,
    recommended: false,
  }
}

function compareSemver(left: string, right: string) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

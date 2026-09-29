import path from 'node:path'
import { resolveExecutable } from '../runtime/resolveExecutable'

// User-owned applications, not supervised Validation/AI jobs. No shell commands
// or renderer-selected executables; TERMINAL can select one known launcher only.
const linuxTerminals: ReadonlyArray<readonly [string, string | null]> = [
  ['gnome-terminal', '--working-directory'],
  ['konsole', '--workdir'],
  ['xfce4-terminal', '--working-directory'],
  ['kitty', '--directory'],
  ['alacritty', '--working-directory'],
  ['x-terminal-emulator', null],
  ['xterm', null],
]

export async function resolveWorkspaceTerminal(
  workspace: string,
  platform: NodeJS.Platform = process.platform,
  configured = process.env.TERMINAL,
  resolve: (name: string) => Promise<string | null> = resolveExecutable,
): Promise<{ command: string; args: string[] }> {
  if (platform === 'win32' || platform === 'darwin') {
    const command = await resolve(platform === 'win32' ? 'cmd.exe' : 'open')
    if (!command) throw new Error('Terminal do sistema não encontrado.')
    // cwd is passed to spawn. Never interpolate the workspace into cmd /K:
    // a directory name containing shell metacharacters is data, not a command.
    return { command, args: platform === 'win32' ? ['/K'] : ['-a', 'Terminal', workspace] }
  }
  if (platform !== 'linux') throw new Error('Abertura de terminal não suportada nesta plataforma.')
  const preference = configured?.trim()
  const preferred = preference ? linuxTerminals.find(([name]) => path.basename(preference) === name) : undefined
  const candidates = preferred ? [preferred, ...linuxTerminals.filter(([name]) => name !== preferred[0])] : linuxTerminals
  for (const [name, directoryFlag] of candidates) {
    const command = await resolve(preferred?.[0] === name ? preference! : name)
    if (command) return { command, args: directoryFlag ? [directoryFlag, workspace] : [] }
  }
  throw new Error('Terminal não encontrado. Instale um terminal suportado ou defina TERMINAL com seu executável (sem argumentos).')
}

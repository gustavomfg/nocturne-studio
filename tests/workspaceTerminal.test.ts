import { describe, expect, it, vi } from 'vitest'
import { resolveWorkspaceTerminal } from '../electron/workspaces/WorkspaceTerminal'

describe('workspace terminal selection', () => {
  const workspace = '/workspace with spaces/&literal'
  it('finds an installed terminal without Debian alternatives or TERMINAL', async () => {
    const resolve = vi.fn(async (name: string) => name === 'konsole' ? '/usr/bin/konsole' : null)
    expect(await resolveWorkspaceTerminal(workspace, 'linux', '', resolve)).toEqual({ command: '/usr/bin/konsole', args: ['--workdir', workspace] })
  })
  it('honors a known executable preference without shell parsing', async () => {
    const resolve = vi.fn(async (name: string) => name === '/usr/bin/kitty' ? name : null)
    expect(await resolveWorkspaceTerminal(workspace, 'linux', '/usr/bin/kitty', resolve)).toEqual({ command: '/usr/bin/kitty', args: ['--directory', workspace] })
    expect(resolve).toHaveBeenCalledTimes(1)
  })
  it.each(['kitty --execute evil', 'sh -c evil', 'kitty;evil', '/tmp/unknown'])('ignores command-like or unsupported preference %s', async (preference) => {
    const resolve = vi.fn(async (name: string) => name === 'xterm' ? '/usr/bin/xterm' : null)
    expect(await resolveWorkspaceTerminal(workspace, 'linux', preference, resolve)).toEqual({ command: '/usr/bin/xterm', args: [] })
    expect(resolve).not.toHaveBeenCalledWith(preference)
  })
  it('falls back after a missing configured terminal', async () => {
    const resolve = vi.fn(async (name: string) => name === 'gnome-terminal' ? '/usr/bin/gnome-terminal' : null)
    expect(await resolveWorkspaceTerminal(workspace, 'linux', 'kitty', resolve)).toEqual({ command: '/usr/bin/gnome-terminal', args: ['--working-directory', workspace] })
  })
  it('fails honestly when no terminal is installed', async () => {
    await expect(resolveWorkspaceTerminal(workspace, 'linux', '', async () => null)).rejects.toThrow('Terminal não encontrado')
  })
  it('never puts a workspace pathname in the Windows shell command', async () => {
    expect(await resolveWorkspaceTerminal('C:\\project & whoami', 'win32', undefined, async () => 'C:\\Windows\\System32\\cmd.exe')).toEqual({ command: 'C:\\Windows\\System32\\cmd.exe', args: ['/K'] })
  })
  it('passes the macOS directory as one data argument', async () => {
    expect(await resolveWorkspaceTerminal(workspace, 'darwin', undefined, async () => '/usr/bin/open')).toEqual({ command: '/usr/bin/open', args: ['-a', 'Terminal', workspace] })
  })
})

import { mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const output = path.join(root, 'dist-native')
mkdirSync(output, { recursive: true })
const source = path.join(root, 'native', 'rollback-boundary.cpp')
const binary = path.join(output, process.platform === 'win32' ? 'rollback-boundary.exe' : 'rollback-boundary')
let result
if (process.platform === 'win32') {
  const vswhere = path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  if (!existsSync(vswhere)) throw new Error('MSVC build tools required for native boundary.')
  const discovery = spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8', shell: false })
  const installation = discovery.stdout?.trim()
  if (discovery.status !== 0 || !installation) throw new Error('MSVC installation unavailable.')
  const setup = path.join(installation, 'Common7', 'Tools', 'VsDevCmd.bat')
  // Build-time compiler setup only, never a renderer/project execution path.
  for (const value of [setup, source, binary, output]) if (/["%\r\n]/.test(value)) throw new Error('Unsupported compiler path.')
  result = spawnSync('cmd.exe', ['/d', '/s', '/c', `call "${setup}" -arch=x64 && cl /Bv /nologo /EHsc /std:c++17 /W4 /WX /O2 "${source}" /Fe:"${binary}" /Fo:"${path.join(output, 'rollback-boundary.obj')}"`], { stdio: 'inherit', shell: false, windowsVerbatimArguments: true })
} else {
  result = spawnSync(process.platform === 'darwin' ? 'clang++' : 'g++', ['-std=c++17', '-O2', '-Wall', '-Wextra', '-Werror', source, '-o', binary], { stdio: 'inherit', shell: false })
}
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
console.log(`Native rollback worker built for ${process.platform}/${process.arch}.`)

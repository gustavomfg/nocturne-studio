import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const args = process.argv.slice(2)
const platform = option('--platform')
const releaseDirectory = path.resolve(option('--release-directory') || path.join('release', packageJson.version))
const outputDirectory = path.resolve(option('--output') || 'release-output')

if (!['linux', 'windows', 'macos'].includes(platform)) throw new Error(`Plataforma inválida: ${platform || '(ausente)'}`)
if (!fs.existsSync(releaseDirectory)) throw new Error(`Diretório de release ausente: ${releaseDirectory}`)
fs.mkdirSync(outputDirectory, { recursive: true })

const names = {
  linux: [
    `Nocturne.Studio-Linux-${packageJson.version}.AppImage`,
    `Nocturne.Studio-Linux-${packageJson.version}.tar.gz`,
    'builder-debug.yml',
    'latest-linux.yml',
    'SHA256SUMS',
    'SHA256SUMS.sig',
  ],
  windows: [
    `Nocturne-Studio-Windows-${packageJson.version}-Setup.exe`,
    `Nocturne-Studio-Windows-${packageJson.version}-Setup.exe.blockmap`,
    'latest.yml',
    'SHA256SUMS',
  ],
  macos: [
    `Nocturne-Studio-Mac-${packageJson.version}-Installer.dmg`,
    `Nocturne-Studio-Mac-${packageJson.version}-Installer.dmg.blockmap`,
    `Nocturne-Studio-Mac-${packageJson.version}-Installer.zip`,
    `Nocturne-Studio-Mac-${packageJson.version}-Installer.zip.blockmap`,
    'latest-mac.yml',
    'SHA256SUMS',
  ],
}[platform]

for (const name of names) {
  const source = path.join(releaseDirectory, name)
  if (!fs.existsSync(source)) throw new Error(`Artefato esperado ausente: ${source}`)
  const checksumName = `SHA256SUMS-${platform === 'macos' ? 'macOS' : platform[0].toUpperCase() + platform.slice(1)}`
  const targetName = name === 'SHA256SUMS' ? checksumName : name === 'SHA256SUMS.sig' ? `${checksumName}.sig` : name
  fs.copyFileSync(source, path.join(outputDirectory, targetName), fs.constants.COPYFILE_EXCL)
}

process.stdout.write(`Artefatos ${platform} preparados em ${outputDirectory}.\n`)

function option(name) {
  const exact = args.indexOf(name)
  if (exact >= 0) return args[exact + 1]
  const prefix = `${name}=`
  const inline = args.find((argument) => argument.startsWith(prefix))
  return inline?.slice(prefix.length)
}

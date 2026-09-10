import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const root = process.cwd()
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const args = process.argv.slice(2)
const platform = option('--platform')
const architecture = option('--architecture')
const releaseDirectory = path.resolve(option('--release-directory') || path.join('release', packageJson.version))

if (!['linux', 'windows', 'macos'].includes(platform)) throw new Error(`Plataforma inválida: ${platform || '(ausente)'}`)
const metadataPath = metadataLocation(platform, architecture, releaseDirectory)
if (!metadataPath || !fs.existsSync(metadataPath)) throw new Error(`app-update.yml ausente para ${platform} em ${releaseDirectory}.`)

const requireFromWorkspace = createRequire(path.join(root, 'package.json'))
const yaml = requireFromWorkspace('js-yaml')
const metadata = yaml.load(fs.readFileSync(metadataPath, 'utf8'))
const expected = { provider: 'github', owner: 'gustavomfg', repo: 'nocturne-studio', releaseType: 'release' }
for (const [key, value] of Object.entries(expected)) {
  if (metadata?.[key] !== value) throw new Error(`app-update.yml inválido: ${key} deve ser ${value}.`)
}
process.stdout.write(`Updater metadata ${platform}: provider github, gustavomfg/nocturne-studio, releaseType release.\n`)

function metadataLocation(name, targetArchitecture, directory) {
  const candidates = {
    linux: [path.join(directory, 'linux-unpacked', 'resources', 'app-update.yml')],
    windows: [path.join(directory, 'win-unpacked', 'resources', 'app-update.yml')],
    macos: [
      ...(targetArchitecture === 'arm64' ? [] : [path.join(directory, 'mac', 'Nocturne Studio.app', 'Contents', 'Resources', 'app-update.yml')]),
      path.join(directory, 'mac-arm64', 'Nocturne Studio.app', 'Contents', 'Resources', 'app-update.yml'),
    ],
  }
  return candidates[name].find((candidate) => fs.existsSync(candidate))
}

function option(name) {
  const exact = args.indexOf(name)
  if (exact >= 0) return args[exact + 1]
  const prefix = `${name}=`
  const inline = args.find((argument) => argument.startsWith(prefix))
  return inline?.slice(prefix.length)
}

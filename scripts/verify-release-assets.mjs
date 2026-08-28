import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const linuxOnly = args.includes('--linux-only')
const directoryArgument = args.find((argument) => !argument.startsWith('--'))
const directory = path.resolve(directoryArgument || path.join('release', JSON.parse(fs.readFileSync('package.json', 'utf8')).version))
if (!fs.existsSync(directory)) throw new Error(`Diretório de artefatos ausente: ${directory}`)

const files = fs.readdirSync(directory).filter((name) => fs.statSync(path.join(directory, name)).isFile())
const allRequirements = [
  ['Linux AppImage', (name) => name.endsWith('.AppImage')],
  ['Linux tar.gz', (name) => name.endsWith('.tar.gz')],
  ['Windows NSIS', (name) => name.endsWith('.exe')],
  ['macOS DMG', (name) => name.endsWith('.dmg')],
  ['macOS ZIP para atualização', (name) => name.endsWith('.zip')],
  ['metadados Windows', (name) => name === 'latest.yml'],
  ['metadados Linux', (name) => name === 'latest-linux.yml'],
  ['metadados macOS', (name) => name === 'latest-mac.yml'],
  ['checksums Linux', (name) => name === 'SHA256SUMS-Linux'],
  ['assinatura GPG Linux', (name) => name === 'SHA256SUMS-Linux.sig'],
  ['checksums Windows', (name) => name === 'SHA256SUMS-Windows'],
  ['checksums macOS', (name) => name === 'SHA256SUMS-macOS'],
]
const linuxRequirements = [
  ['Linux AppImage', (name) => name.endsWith('.AppImage')],
  ['Linux tar.gz', (name) => name.endsWith('.tar.gz')],
  ['metadados Linux', (name) => name === 'latest-linux.yml'],
  ['checksums Linux', (name) => name === 'SHA256SUMS-Linux'],
  ['assinatura GPG Linux', (name) => name === 'SHA256SUMS-Linux.sig'],
]
const requirements = linuxOnly ? linuxRequirements : allRequirements

const missing = requirements.filter(([, predicate]) => !files.some(predicate)).map(([label]) => label)
if (missing.length) throw new Error(`Release incompleta; ausente: ${missing.join(', ')}`)
const scope = linuxOnly ? 'Linux' : 'completo'
process.stdout.write(`Inventário de release ${scope}: ${files.length} arquivo(s) em ${directory}.\n`)

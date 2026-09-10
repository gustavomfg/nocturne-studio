import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const root = process.cwd()
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const args = process.argv.slice(2)
const platforms = requestedPlatforms(args)
const directory = path.resolve(directoryArgument(args) || path.join('release', packageJson.version))

if (!fs.existsSync(directory)) throw new Error(`Diretório de artefatos ausente: ${directory}`)

const entries = fs.readdirSync(directory, { withFileTypes: true })
if (entries.some((entry) => entry.isDirectory())) throw new Error(`Inventário contém diretórios inesperados: ${directory}`)
const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort()
const expected = new Map()

for (const platform of platforms) {
  const specification = platformSpecification(platform, packageJson.version)
  for (const name of specification.files) expected.set(name, `${platform}: ${name}`)
  verifyPlatform(specification)
}

const allowedCommonFiles = new Set(['builder-debug.yml'])
const unexpected = files.filter((name) => !expected.has(name) && !allowedCommonFiles.has(name))
if (unexpected.length) throw new Error(`Inventário contém arquivo(s) inesperado(s) ou duplicado(s): ${unexpected.join(', ')}`)

for (const name of expected.keys()) {
  if (!files.includes(name)) throw new Error(`Release incompleta; ausente: ${expected.get(name)}`)
  if (fs.statSync(path.join(directory, name)).size === 0) throw new Error(`Artefato vazio: ${name}`)
}

const scope = platforms.join(', ')
process.stdout.write(`Inventário de release ${scope}: ${files.length} arquivo(s) validado(s) em ${directory}.\n`)

function verifyPlatform(specification) {
  const missing = specification.files.filter((name) => !files.includes(name))
  if (missing.length) throw new Error(`Release incompleta para ${specification.platform}; ausente: ${missing.join(', ')}`)

  const metadata = loadYaml(path.join(directory, specification.metadata))
  if (metadata?.version !== packageJson.version) throw new Error(`Metadados ${specification.metadata} não correspondem à versão ${packageJson.version}.`)
  const metadataArtifacts = specification.metadataArtifacts || specification.artifacts
  if (!Array.isArray(metadata.files) || metadata.files.length !== metadataArtifacts.length) {
    throw new Error(`Metadados ${specification.metadata} não descrevem exatamente os artefatos esperados.`)
  }

  const metadataNames = metadata.files.map((file) => file?.url)
  const expectedNames = metadataArtifacts.map((artifact) => artifact.name)
  if (new Set(metadataNames).size !== metadataNames.length || metadataNames.some((name) => !expectedNames.includes(name))) {
    throw new Error(`Metadados ${specification.metadata} contêm referências duplicadas ou inesperadas.`)
  }

  for (const artifact of metadataArtifacts) {
    const metadataFile = metadata.files.find((file) => file.url === artifact.name)
    const absolutePath = path.join(directory, artifact.name)
    if (!metadataFile || metadataFile.size !== fs.statSync(absolutePath).size) {
      throw new Error(`Tamanho divergente em ${specification.metadata} para ${artifact.name}.`)
    }
    const sha512 = createHash('sha512').update(fs.readFileSync(absolutePath)).digest('base64')
    if (metadataFile.sha512 !== sha512) throw new Error(`SHA512 divergente em ${specification.metadata} para ${artifact.name}.`)
  }

  const primary = specification.artifacts[0]
  if (metadata.path !== primary.name || metadata.sha512 !== metadata.files[0].sha512) {
    throw new Error(`Referência principal inconsistente em ${specification.metadata}.`)
  }

  verifyChecksums(specification)
}

function verifyChecksums(specification) {
  const checksumPath = path.join(directory, specification.checksums)
  const lines = fs.readFileSync(checksumPath, 'utf8').split(/\r?\n/).filter(Boolean)
  const checksums = new Map()
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64}) \*(.+)$/)
    if (!match || checksums.has(match[2])) throw new Error(`Manifesto de checksums inválido ou duplicado: ${line}`)
    checksums.set(match[2], match[1])
  }

  const expectedNames = specification.artifacts.map((artifact) => artifact.name).sort()
  const actualNames = [...checksums.keys()].sort()
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(`Manifesto ${specification.checksums} não corresponde aos artefatos distribuíveis.`)
  }
  for (const name of expectedNames) {
    const digest = createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex')
    if (checksums.get(name) !== digest) throw new Error(`SHA256 divergente em ${specification.checksums} para ${name}.`)
  }
}

function platformSpecification(platform, version) {
  const specifications = {
    linux: {
      platform: 'Linux',
      artifacts: [
        { name: `Nocturne.Studio-Linux-${version}.AppImage` },
        { name: `Nocturne.Studio-Linux-${version}.tar.gz` },
      ],
      metadataArtifacts: [{ name: `Nocturne.Studio-Linux-${version}.AppImage` }],
      metadata: 'latest-linux.yml',
      checksums: 'SHA256SUMS-Linux',
      files: [
        `Nocturne.Studio-Linux-${version}.AppImage`,
        `Nocturne.Studio-Linux-${version}.tar.gz`,
        'latest-linux.yml',
        'SHA256SUMS-Linux',
        'SHA256SUMS-Linux.sig',
      ],
    },
    windows: {
      platform: 'Windows',
      artifacts: [{ name: `Nocturne-Studio-Windows-${version}-Setup.exe` }],
      metadata: 'latest.yml',
      checksums: 'SHA256SUMS-Windows',
      files: [
        `Nocturne-Studio-Windows-${version}-Setup.exe`,
        `Nocturne-Studio-Windows-${version}-Setup.exe.blockmap`,
        'latest.yml',
        'SHA256SUMS-Windows',
      ],
    },
    macos: {
      platform: 'macOS',
      artifacts: [
        { name: `Nocturne-Studio-Mac-${version}-Installer.zip` },
        { name: `Nocturne-Studio-Mac-${version}-Installer.dmg` },
      ],
      metadata: 'latest-mac.yml',
      checksums: 'SHA256SUMS-macOS',
      files: [
        `Nocturne-Studio-Mac-${version}-Installer.dmg`,
        `Nocturne-Studio-Mac-${version}-Installer.dmg.blockmap`,
        `Nocturne-Studio-Mac-${version}-Installer.zip`,
        `Nocturne-Studio-Mac-${version}-Installer.zip.blockmap`,
        'latest-mac.yml',
        'SHA256SUMS-macOS',
      ],
    },
  }
  const specification = specifications[platform]
  if (!specification) throw new Error(`Plataforma de release desconhecida: ${platform}`)
  return specification
}

function loadYaml(file) {
  const requireFromWorkspace = createRequire(path.join(root, 'package.json'))
  let yaml
  try {
    yaml = requireFromWorkspace('js-yaml')
  } catch (error) {
    throw new Error(`Não foi possível carregar js-yaml para validar ${path.basename(file)}: ${error.message}`, { cause: error })
  }
  try {
    return yaml.load(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`Metadados YAML inválidos em ${path.basename(file)}: ${error.message}`, { cause: error })
  }
}

function requestedPlatforms(argumentsList) {
  if (argumentsList.includes('--linux-only')) return ['linux']
  const values = []
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (argument === '--platform' || argument === '--platforms') values.push(...(argumentsList[index + 1] || '').split(','))
    if (argument.startsWith('--platform=') || argument.startsWith('--platforms=')) values.push(argument.split('=')[1])
  }
  if (!values.length) return ['linux', 'windows', 'macos']
  const normalized = [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))]
  if (normalized.some((value) => !['linux', 'windows', 'macos'].includes(value))) throw new Error(`Plataforma inválida: ${normalized.join(', ')}`)
  return normalized
}

function directoryArgument(argumentsList) {
  const valueOptions = new Set(['--platform', '--platforms'])
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index]
    if (valueOptions.has(argument)) {
      index += 1
      continue
    }
    if (!argument.startsWith('--')) return argument
  }
  return undefined
}

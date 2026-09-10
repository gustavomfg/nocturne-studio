import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []
const verifier = path.join(process.cwd(), 'scripts/verify-release-assets.mjs')
const version = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version as string

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
})

describe('verificador de assets de release', () => {
  it('valida artefato, blockmap, metadata e checksum Windows', () => {
    const directory = createDirectory()
    const artifact = `Nocturne-Studio-Windows-${version}-Setup.exe`
    const blockmap = `${artifact}.blockmap`
    write(directory, artifact, 'windows-installer')
    write(directory, blockmap, 'windows-blockmap')
    write(directory, 'latest.yml', metadata(version, [artifact]))
    write(directory, 'SHA256SUMS-Windows', checksum(directory, [artifact]))

    expect(() => execFileSync(process.execPath, [verifier, '--platform', 'windows', directory], { stdio: 'pipe' })).not.toThrow()
  })

  it('rejeita artifact extra mesmo quando os arquivos obrigatórios existem', () => {
    const directory = createDirectory()
    const artifact = `Nocturne-Studio-Windows-${version}-Setup.exe`
    write(directory, artifact, 'windows-installer')
    write(directory, `${artifact}.blockmap`, 'windows-blockmap')
    write(directory, 'latest.yml', metadata(version, [artifact]))
    write(directory, 'SHA256SUMS-Windows', checksum(directory, [artifact]))
    write(directory, 'unexpected.zip', 'não pertence ao inventário Windows')

    expect(() => execFileSync(process.execPath, [verifier, '--platform', 'windows', directory], { stdio: 'pipe' })).toThrow(/inesperado|duplicado/)
  })

  it('rejeita checksum que não corresponde ao conteúdo publicado', () => {
    const directory = createDirectory()
    const artifact = `Nocturne-Studio-Windows-${version}-Setup.exe`
    write(directory, artifact, 'windows-installer')
    write(directory, `${artifact}.blockmap`, 'windows-blockmap')
    write(directory, 'latest.yml', metadata(version, [artifact]))
    write(directory, 'SHA256SUMS-Windows', `${'0'.repeat(64)} *${artifact}\n`)

    expect(() => execFileSync(process.execPath, [verifier, '--platform', 'windows', directory], { stdio: 'pipe' })).toThrow(/SHA256 divergente/)
  })
})

function createDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-release-assets-'))
  directories.push(directory)
  return directory
}

function write(directory: string, name: string, content: string) {
  fs.writeFileSync(path.join(directory, name), content)
}

function metadata(releaseVersion: string, artifactNames: string[]) {
  const files = artifactNames.map((name) => {
    const content = fs.readFileSync(path.join(currentDirectory(), name))
    return `  - url: ${name}\n    sha512: ${createHash('sha512').update(content).digest('base64')}\n    size: ${content.length}`
  })
  const first = artifactNames[0]
  const firstContent = fs.readFileSync(path.join(currentDirectory(), first))
  const firstHash = createHash('sha512').update(firstContent).digest('base64')
  return `version: ${releaseVersion}\nfiles:\n${files.join('\n')}\npath: ${first}\nsha512: ${firstHash}\n`
}

function checksum(directory: string, artifactNames: string[]) {
  return artifactNames.map((name) => `${createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex')} *${name}`).join('\n') + '\n'
}

function currentDirectory() {
  return directories[directories.length - 1] as string
}

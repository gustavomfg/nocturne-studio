import fs from 'node:fs'

const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

function normalizeVersion(value, label) {
  const version = String(value ?? '').trim()
  if (!versionPattern.test(version)) throw new Error(`${label} não é uma versão semântica válida.`)
  return version
}

export function readPackageVersion(packagePath) {
  if (!packagePath) throw new Error('O caminho do package.json histórico não foi informado.')
  let metadata
  try {
    metadata = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  } catch (error) {
    throw new Error('Não foi possível ler o package.json histórico.', { cause: error })
  }
  return normalizeVersion(metadata?.version, 'A versão do package.json histórico')
}

export function resolveBaseVersion({ packagePath, explicitVersion } = {}) {
  if (packagePath) return readPackageVersion(packagePath)
  if (explicitVersion) return normalizeVersion(explicitVersion, 'A versão base do rehearsal')
  throw new Error('A identidade da versão base não foi informada pelo worktree histórico.')
}

export function validateRehearsalVersions({
  baseVersion,
  baseArtifactVersion,
  candidateVersion,
  candidatePackageVersion,
  candidateArtifactVersion,
}) {
  const expectedBase = normalizeVersion(baseVersion, 'A versão base do rehearsal')
  const expectedCandidate = normalizeVersion(candidateVersion, 'A versão candidata do rehearsal')
  const packageVersion = normalizeVersion(candidatePackageVersion, 'A versão do package.json candidato')
  const artifactBase = normalizeVersion(baseArtifactVersion, 'A versão do pacote base')
  const artifactCandidate = normalizeVersion(candidateArtifactVersion, 'A versão do pacote candidato')

  if (expectedBase === expectedCandidate) throw new Error('As versões base e candidata do rehearsal precisam ser diferentes.')
  if (artifactBase !== expectedBase) throw new Error(`O pacote base não representa ${expectedBase}: ${artifactBase}`)
  if (packageVersion !== expectedCandidate) throw new Error(`A versão candidata esperada (${expectedCandidate}) não corresponde ao package.json do HEAD (${packageVersion}).`)
  if (artifactCandidate !== expectedCandidate) throw new Error(`O pacote candidato não representa ${expectedCandidate}: ${artifactCandidate}`)
  if (expectedCandidate.includes('-')) throw new Error(`O rehearsal stable exige uma versão sem prerelease: ${expectedCandidate}`)

  return { baseVersion: expectedBase, candidateVersion: expectedCandidate }
}

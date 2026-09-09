import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { readPackageVersion, resolveBaseVersion, validateRehearsalVersions } from './updater-rehearsal-contract.mjs'

const valid = {
  baseVersion: '1.0.0',
  baseArtifactVersion: '1.0.0',
  candidateVersion: '1.0.1',
  candidatePackageVersion: '1.0.1',
  candidateArtifactVersion: '1.0.1',
}

assert.deepEqual(validateRehearsalVersions(valid), { baseVersion: '1.0.0', candidateVersion: '1.0.1' })
assert.throws(() => validateRehearsalVersions({ ...valid, baseArtifactVersion: '0.9.5-beta' }), /pacote base não representa 1\.0\.0/)
assert.throws(() => validateRehearsalVersions({ ...valid, candidateArtifactVersion: '1.1.0' }), /pacote candidato não representa 1\.0\.1/)
assert.throws(() => validateRehearsalVersions({ ...valid, candidateVersion: '1.1.0' }), /não corresponde ao package\.json do HEAD/)

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-updater-contract-'))
try {
  const historicalPackage = path.join(temporary, 'package.json')
  const historicalSource = execFileSync('git', ['show', 'v1.0.0:package.json'], { encoding: 'utf8' })
  fs.writeFileSync(historicalPackage, historicalSource)
  assert.equal(readPackageVersion(historicalPackage), '1.0.0')
  assert.equal(resolveBaseVersion({ packagePath: historicalPackage }), '1.0.0')
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}

process.stdout.write('Updater rehearsal version contract: 5 cases passed.\n')

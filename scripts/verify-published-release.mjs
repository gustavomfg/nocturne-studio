import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = process.cwd()
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const tag = `v${version}`
const repository = process.env.GITHUB_REPOSITORY || 'gustavomfg/nocturne-studio'
const expectedSha = process.env.RELEASE_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const directory = path.resolve(process.argv[2] || path.join('release', version))

execFileSync(process.execPath, [path.join(root, 'scripts/verify-release-assets.mjs'), directory], { stdio: 'inherit' })

const ref = JSON.parse(execFileSync('gh', ['api', `repos/${repository}/git/ref/tags/${tag}`], { encoding: 'utf8' }))
if (ref.object?.type !== 'commit' || ref.object.sha !== expectedSha) throw new Error(`${tag} does not point to ${expectedSha}.`)

const release = JSON.parse(execFileSync('gh', ['release', 'view', tag, '--repo', repository, '--json', 'assets,body,isDraft,isPrerelease,publishedAt,tagName'], { encoding: 'utf8' }))
if (release.tagName !== tag || release.isDraft || release.isPrerelease || !release.publishedAt) throw new Error(`${tag} is not a published stable release.`)

const notes = fs.readFileSync(path.join(root, 'docs/releases', `${tag}.md`), 'utf8').trimEnd()
if (release.body.trimEnd() !== notes) throw new Error(`${tag} release notes differ from the versioned source.`)

const localNames = fs.readdirSync(directory).sort()
const remoteNames = release.assets.map((asset) => asset.name).sort()
if (JSON.stringify(localNames) !== JSON.stringify(remoteNames)) throw new Error(`${tag} published asset inventory differs from the verified local inventory.`)

for (const asset of release.assets) {
  const file = path.join(directory, asset.name)
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  const digest = hash.digest('hex')
  if (asset.digest !== `sha256:${digest}` || asset.size !== fs.statSync(file).size) {
    throw new Error(`${tag} published digest or size differs: ${asset.name}`)
  }
}

const keyring = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-release-keyring-'))
try {
  fs.chmodSync(keyring, 0o700)
  execFileSync('gpg', ['--homedir', keyring, '--batch', '--import', path.join(root, 'docs/release-signing-public.asc')], { stdio: 'pipe' })
  execFileSync('gpg', ['--homedir', keyring, '--batch', '--verify', path.join(directory, 'SHA256SUMS-Linux.sig'), path.join(directory, 'SHA256SUMS-Linux')], { stdio: 'pipe' })
} finally {
  fs.rmSync(keyring, { recursive: true, force: true })
}

process.stdout.write(`${tag} published at ${release.publishedAt}: ${remoteNames.length} assets, exact tag SHA, SHA256 digests, updater metadata, notes and Linux GPG signature verified.\n`)

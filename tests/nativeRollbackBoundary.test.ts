import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { NativeRollbackOperation } from '../electron/change-control/NativeRollbackOperation'
import { canonicalTestPath, removeTestDirectory } from './helpers/platform'

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const release of cleanup.splice(0).reverse()) await release() })

async function fixture() {
  const base = canonicalTestPath(fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-native-boundary-')))
  cleanup.push(() => removeTestDirectory(base))
  const workspace = path.join(base, 'workspace')
  const recovery = path.join(base, 'recovery')
  const outside = path.join(base, 'outside')
  for (const directory of [workspace, recovery, outside, path.join(workspace, 'parent')]) fs.mkdirSync(directory, { recursive: true })
  const target = path.join(workspace, 'parent', 'target.txt')
  fs.writeFileSync(target, 'AFTER')
  fs.writeFileSync(path.join(outside, 'target.txt'), 'OUTSIDE')
  const operation = await NativeRollbackOperation.create(workspace, recovery)
  cleanup.push(() => operation.close())
  return { base, workspace, recovery, outside, target, operation }
}

function peer(source: string, paths: string[]) {
  const result = spawnSync(process.execPath, ['-e', source, ...paths], { shell: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
}

describe.runIf(process.platform === 'linux')('native Linux rollback capabilities (real filesystem)', () => {
  it('publishes the anonymous staged object, never a substituted source pathname', async () => {
    const value = await fixture()
    const observation = await value.operation.inspect('parent/target.txt')
    expect(observation.content.toString()).toBe('AFTER')
    await value.operation.stage(Buffer.from('BEFORE'), 0o644)
    // No named stage is part of the native source authority. A separate process
    // creates tempting stage/temp names, which must never become publication sources.
    peer('const fs=require("node:fs");for(const p of process.argv.slice(1))fs.writeFileSync(p,"SUBSTITUTE-X")', [path.join(value.workspace, 'parent', 'stage'), `${value.target}.tmp`])
    await value.operation.journal({ step: 'displace-intent' })
    await value.operation.displace('.nocturne-rollback-test.after')
    await value.operation.journal({ step: 'publish-intent' })
    await value.operation.publish()
    expect(fs.readFileSync(value.target, 'utf8')).toBe('BEFORE')
    expect(fs.readFileSync(path.join(value.workspace, 'parent', '.nocturne-rollback-test.after'), 'utf8')).toBe('AFTER')
    expect(fs.readFileSync(`${value.target}.tmp`, 'utf8')).toBe('SUBSTITUTE-X')
  })

  it('revokes after a separate process replaces the acquired parent with an external symlink', async () => {
    const value = await fixture()
    await value.operation.inspect('parent/target.txt')
    await value.operation.stage(Buffer.from('BEFORE'), 0o644)
    peer('const fs=require("node:fs");const [p,o]=process.argv.slice(1);fs.renameSync(p,p+"-retained");fs.symlinkSync(o,p,"dir")', [path.join(value.workspace, 'parent'), value.outside])
    await expect(value.operation.displace('.nocturne-rollback-test.after')).rejects.toMatchObject({ outcome: 'REVOKED' })
    await expect(value.operation.publish()).rejects.toMatchObject({ outcome: 'REVOKED' })
    expect(fs.readFileSync(path.join(value.outside, 'target.txt'), 'utf8')).toBe('OUTSIDE')
    expect(fs.readdirSync(value.outside)).toEqual(['target.txt'])
    expect(fs.readFileSync(path.join(value.workspace, 'parent-retained', 'target.txt'), 'utf8')).toBe('AFTER')
  })

  it('preserves a concurrent destination and displaced AFTER; does not compensate', async () => {
    const value = await fixture()
    await value.operation.inspect('parent/target.txt')
    await value.operation.stage(Buffer.from('BEFORE'), 0o644)
    await value.operation.displace('.nocturne-rollback-test.after')
    peer('require("node:fs").writeFileSync(process.argv[1],"CONCURRENT")', [value.target])
    await expect(value.operation.publish()).rejects.toMatchObject({ outcome: 'CONFLICT' })
    await expect(value.operation.displace('.nocturne-rollback-another.after')).rejects.toMatchObject({ outcome: 'REVOKED' })
    expect(fs.readFileSync(value.target, 'utf8')).toBe('CONCURRENT')
    expect(fs.readFileSync(path.join(value.workspace, 'parent', '.nocturne-rollback-test.after'), 'utf8')).toBe('AFTER')
  })

  it('retains a concurrently replaced leaf before any restoration publication', async () => {
    const value = await fixture()
    await value.operation.inspect('parent/target.txt')
    await value.operation.stage(Buffer.from('BEFORE'), 0o644)
    peer('const fs=require("node:fs");const p=process.argv[1];fs.renameSync(p,p+".original");fs.writeFileSync(p,"COMPETING")', [value.target])
    await expect(value.operation.displace('.nocturne-rollback-test.after')).rejects.toMatchObject({ outcome: 'CONFLICT' })
    expect(fs.readFileSync(value.target, 'utf8')).toBe('COMPETING')
    expect(fs.readFileSync(`${value.target}.original`, 'utf8')).toBe('AFTER')
  })

  it('copy-on-replace does not mutate an external hardlink alias', async () => {
    const value = await fixture()
    const alias = path.join(value.outside, 'alias')
    fs.linkSync(value.target, alias)
    await value.operation.inspect('parent/target.txt')
    await value.operation.stage(Buffer.from('BEFORE'), 0o644)
    await value.operation.displace('.nocturne-rollback-test.after')
    await value.operation.publish()
    expect(fs.readFileSync(alias, 'utf8')).toBe('AFTER')
    expect(fs.statSync(value.target).ino).not.toBe(fs.statSync(alias).ino)
  })

  it('does not create missing parents', async () => {
    const value = await fixture()
    await expect(value.operation.inspect('missing/target.txt')).rejects.toMatchObject({ outcome: 'CONFLICT' })
    expect(fs.existsSync(path.join(value.workspace, 'missing'))).toBe(false)
  })

  it('rejects a symbolic leaf without touching the external object', async () => {
    const value = await fixture()
    fs.unlinkSync(value.target)
    fs.symlinkSync(path.join(value.outside, 'target.txt'), value.target)
    await expect(value.operation.inspect('parent/target.txt')).rejects.toMatchObject({ outcome: 'CONFLICT' })
    expect(fs.readFileSync(path.join(value.outside, 'target.txt'), 'utf8')).toBe('OUTSIDE')
    expect(fs.readdirSync(value.outside)).toEqual(['target.txt'])
  })

  it('refuses a retention-entry collision without moving either object', async () => {
    const value = await fixture()
    await value.operation.inspect('parent/target.txt')
    await value.operation.stage(Buffer.from('BEFORE'), 0o644)
    const retained = path.join(value.workspace, 'parent', '.nocturne-rollback-test.after')
    fs.writeFileSync(retained, 'UNRELATED')
    await expect(value.operation.displace('.nocturne-rollback-test.after')).rejects.toMatchObject({ outcome: 'CONFLICT' })
    expect(fs.readFileSync(retained, 'utf8')).toBe('UNRELATED')
    expect(fs.readFileSync(value.target, 'utf8')).toBe('AFTER')
  })

  it('creates empty content exclusively and closes unnamed stages without namespace cleanup', async () => {
    const value = await fixture()
    await value.operation.inspect('parent/target.txt')
    await value.operation.stage(Buffer.alloc(0), 0o644)
    await value.operation.displace('.nocturne-rollback-test.after')
    await value.operation.publish()
    await value.operation.close()
    expect(fs.readFileSync(value.target)).toEqual(Buffer.alloc(0))
    expect(fs.readdirSync(path.dirname(value.target)).sort()).toEqual(['.nocturne-rollback-test.after', 'target.txt'])
  })

  it('rejects traversal and preserves journal intent even after revocation', async () => {
    const value = await fixture()
    await value.operation.journal({ status: 'running', step: 'intent' })
    await expect(value.operation.inspect('../outside/target.txt')).rejects.toMatchObject({ outcome: 'CONFLICT' })
    await value.operation.journal({ status: 'conflicted', outcome: 'REVOKED' })
    expect(fs.readFileSync(path.join(value.recovery, 'steps.jsonl'), 'utf8').trim().split('\n')).toHaveLength(2)
    await expect(value.operation.stage(Buffer.from('BAD'), 0o644)).rejects.toMatchObject({ outcome: 'REVOKED' })
  })

  it('closed capability cannot be reused', async () => {
    const value = await fixture()
    await value.operation.close()
    await expect(value.operation.publish()).rejects.toMatchObject({ outcome: 'REVOKED' })
    expect(fs.readFileSync(value.target, 'utf8')).toBe('AFTER')
  })

  it('retains compact ordered steps instead of appending the complete growing snapshot each time', async () => {
    const value = await fixture()
    const observations: string[] = []
    for (let index = 0; index < 40; index++) {
      observations.push(`file-${index}:${'evidence'.repeat(100)}`)
      await value.operation.journal({ step: index, observations }, { step: index, added: observations[observations.length - 1] })
    }
    const steps = fs.readFileSync(path.join(value.recovery, 'steps.jsonl'), 'utf8')
    expect(steps.trim().split('\n')).toHaveLength(40)
    expect(Buffer.byteLength(steps)).toBeLessThan(fs.statSync(path.join(value.recovery, 'operation.json')).size * 2)
    expect(JSON.parse(fs.readFileSync(path.join(value.recovery, 'operation.json'), 'utf8')).observations).toHaveLength(40)
  })

  it('classifies disposed unconfirmed publication as UNKNOWN and never replays the retained intent', async () => {
    const value = await fixture()
    await value.operation.inspect('parent/target.txt')
    await value.operation.stage(Buffer.from('BEFORE'), 0o644)
    await value.operation.displace('.nocturne-rollback-test.after')
    await value.operation.journal({ step: 'publish-intent', status: 'running' })
    const unconfirmed = expect(value.operation.publish()).rejects.toMatchObject({ outcome: 'UNKNOWN' })
    await value.operation.close()
    await unconfirmed
    // The command may have executed before its response was discarded. Neither
    // destination absence nor matching bytes establishes a terminal decision.
    if (fs.existsSync(value.target)) expect(fs.readFileSync(value.target, 'utf8')).toBe('BEFORE')
    const retained = path.join(value.workspace, 'parent', '.nocturne-rollback-test.after')
    expect(fs.readFileSync(retained, 'utf8')).toBe('AFTER')
    expect(JSON.parse(fs.readFileSync(path.join(value.recovery, 'operation.json'), 'utf8'))).toEqual({ step: 'publish-intent', status: 'running' })
    const entries = fs.readdirSync(path.dirname(value.target)).sort()
    await expect(NativeRollbackOperation.create(value.workspace, value.recovery)).rejects.toMatchObject({ outcome: 'CONFLICT' })
    expect(fs.readdirSync(path.dirname(value.target)).sort()).toEqual(entries)
    expect(fs.readFileSync(retained, 'utf8')).toBe('AFTER')
  })
})

it.runIf(process.platform !== 'linux')('unverified backend fails closed before workspace mutation', async () => {
  const base = canonicalTestPath(fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-unsupported-boundary-')))
  cleanup.push(() => removeTestDirectory(base))
  const workspace = path.join(base, 'project'), recovery = path.join(base, 'recovery')
  fs.mkdirSync(workspace); fs.mkdirSync(recovery)
  fs.writeFileSync(path.join(workspace, 'target'), 'UNCHANGED')
  await expect(NativeRollbackOperation.create(workspace, recovery)).rejects.toMatchObject({ outcome: 'UNSUPPORTED' })
  expect(fs.readFileSync(path.join(workspace, 'target'), 'utf8')).toBe('UNCHANGED')
  expect(fs.readdirSync(recovery)).toEqual([])
})

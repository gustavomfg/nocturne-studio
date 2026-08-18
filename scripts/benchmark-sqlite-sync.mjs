import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'

// better-sqlite3 is compiled for Electron's ABI. Keep the public command
// reproducible while delegating the actual workload to the supported runtime.
if (!process.versions.electron) {
  const electron = createRequire(import.meta.url)('electron')
  const result = spawnSync(electron, [process.argv[1], ...process.argv.slice(2)], {
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.status ?? 1)
}

const Database = createRequire(import.meta.url)('better-sqlite3')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-sqlite-benchmark-'))
const samples = 120
const warmup = 12

try {
  const results = ['NORMAL', 'FULL'].map((synchronous) => measure(synchronous))
  const normal = results.find((item) => item.synchronous === 'NORMAL')
  const full = results.find((item) => item.synchronous === 'FULL')
  const overhead = normal && full ? ((full.medianMs / normal.medianMs) - 1) * 100 : null
  process.stdout.write(`${JSON.stringify({
    runtime: { electron: process.versions.electron, node: process.versions.node, platform: process.platform },
    workload: { warmup, samples, operations: 'conversation + 3 messages + workspace metadata + suggestion per transaction' },
    results,
    fullMedianOverNormalPercent: overhead,
  })}\n`)
} finally {
  fs.rmSync(directory, { recursive: true, force: true })
}

function measure(synchronous) {
  const database = new Database(path.join(directory, `${synchronous.toLowerCase()}.db`))
  database.pragma('journal_mode = WAL')
  database.pragma(`synchronous = ${synchronous}`)
  database.pragma('foreign_keys = ON')
  const actualSynchronous = database.pragma('synchronous', { simple: true })
  if (actualSynchronous !== (synchronous === 'FULL' ? 2 : 1)) throw new Error(`SQLite não aplicou synchronous=${synchronous}: ${actualSynchronous}`)
  database.exec(`
    CREATE TABLE conversations (id INTEGER PRIMARY KEY, title TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE messages (id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL);
    CREATE TABLE workspace_memory (workspace TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE suggestions (id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL, status TEXT NOT NULL, result TEXT);
  `)
  const write = database.transaction((index) => {
    database.prepare('INSERT INTO conversations(id,title,updated_at) VALUES(?,?,?)').run(index, `Conversation ${index}`, new Date().toISOString())
    const message = database.prepare('INSERT INTO messages(id,conversation_id,role,content) VALUES(?,?,?,?)')
    message.run(index * 10, index, 'user', 'request')
    message.run(index * 10 + 1, index, 'assistant', 'response')
    message.run(index * 10 + 2, index, 'system', 'context')
    database.prepare('INSERT INTO workspace_memory(workspace,content,updated_at) VALUES(?,?,?)').run(`/workspace/${index}`, 'memory', new Date().toISOString())
    database.prepare('INSERT INTO suggestions(id,conversation_id,status,result) VALUES(?,?,?,?)').run(index, index, 'new', null)
  })

  for (let index = 1; index <= warmup; index += 1) write(index)
  const durations = []
  for (let index = warmup + 1; index <= warmup + samples; index += 1) {
    const started = performance.now()
    write(index)
    durations.push(performance.now() - started)
  }
  const sorted = [...durations].sort((left, right) => left - right)
  const medianMs = percentile(sorted, 0.5)
  const p95Ms = percentile(sorted, 0.95)
  const integrity = database.pragma('quick_check', { simple: true })
  database.close()
  return { synchronous, actualSynchronous, journalMode: 'wal', integrity, medianMs, p95Ms, totalMs: durations.reduce((sum, value) => sum + value, 0) }
}

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))]
}

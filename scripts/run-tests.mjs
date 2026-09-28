import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const electron = require('electron')
const vitest = path.join(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs')
const projectRequire = path.join(process.cwd(), 'package.json')
const electronEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }

function probeElectron(source) {
  const result = spawnSync(electron, ['-e', source], {
    encoding: 'utf8',
    shell: false,
    env: electronEnv,
  })

  return {
    ...result,
    stderr: result.stderr?.trim() ?? '',
    stdout: result.stdout?.trim() ?? '',
  }
}

const runtimeProbe = probeElectron(
  "process.stdout.write(JSON.stringify({ electron: process.versions.electron, node: process.versions.node, modules: process.versions.modules }))",
)

if (runtimeProbe.error || runtimeProbe.status !== 0 || !runtimeProbe.stdout) {
  console.error('Preflight do runtime Electron falhou; não foi possível verificar o ABI nativo.')
  if (runtimeProbe.error) console.error(runtimeProbe.error.message)
  if (runtimeProbe.stderr) console.error(runtimeProbe.stderr)
  process.exitCode = 1
} else {
  let runtime
  try {
    runtime = JSON.parse(runtimeProbe.stdout)
  } catch (error) {
    console.error('Preflight do runtime Electron retornou dados inválidos; não foi possível verificar o ABI nativo.')
    console.error(error.message)
    process.exitCode = 1
  }

  if (!runtime) process.exitCode = 1
  else {
    const nativeProbe = probeElectron(
      `const projectRequire = require('node:module').createRequire(${JSON.stringify(projectRequire)}); const Database = projectRequire('better-sqlite3'); const database = new Database(':memory:'); database.close(); process.stdout.write('ok')`,
    )

    if (nativeProbe.error || nativeProbe.status !== 0 || nativeProbe.stdout !== 'ok') {
      console.error(`Preflight ABI do better-sqlite3 falhou no Electron ${runtime.electron} (Node ${runtime.node}, módulos ${runtime.modules}).`)
      console.error('Execute npm run rebuild:native e tente novamente antes de iniciar os testes.')
      if (nativeProbe.error) console.error(nativeProbe.error.message)
      if (nativeProbe.stderr) console.error(nativeProbe.stderr)
      process.exitCode = 1
    } else if (process.argv.includes('--abi-only')) {
      console.log(`ABI do better-sqlite3 compatível com Electron ${runtime.electron} (módulos ${runtime.modules}).`)
      process.exitCode = 0
    } else {
      // Execute o Vitest com o Node embutido no Electron. Recompilar better-sqlite3
      // enquanto o Nocturne está aberto pode sobrescrever o addon nativo mapeado e
      // encerrar o processo inteiro com SIGBUS/segmentation fault.
      const mode = process.argv.includes('--watch') ? [] : ['run']
      const filters = process.argv.slice(2).filter((argument) => argument !== '--watch')
      const result = spawnSync(electron, [vitest, ...mode, ...filters], { stdio: 'inherit', shell: false, env: electronEnv })
      process.exitCode = result.status ?? 1
    }
  }
}

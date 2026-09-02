import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const releaseDirectory = path.join(root, 'release', pkg.version)

if (process.argv.includes('--checksums')) {
  writeChecksums()
} else {
  await smokePackage()
}

async function smokePackage() {
  const executable = packagedExecutable()
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturne-package-smoke-'))
  const resultPath = path.join(temporary, 'result.json')
  const userData = path.join(temporary, 'user-data')
  fs.mkdirSync(userData)
  const args = [`--user-data-dir=${userData}`]
  if (process.platform === 'linux' && process.env.CI) args.push('--no-sandbox')

  try {
    const result = await run(executable, args, {
      ...process.env,
      NOCTURNE_PACKAGE_SMOKE_OUTPUT: resultPath,
      ELECTRON_ENABLE_LOGGING: '1',
    })
    if (result.code !== 0) throw new Error(`O aplicativo encerrou com código ${result.code}.\n${result.stderr}`)
    if (!fs.existsSync(resultPath)) throw new Error(`O aplicativo não produziu o resultado do smoke test.\n${result.stderr}`)
    const report = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
    const expectedChannels = ['ai', 'artifacts', 'brain', 'clipboard', 'codex', 'conversations', 'data', 'diagnostics', 'documents', 'files', 'git', 'memory', 'models', 'projectIndex', 'providers', 'settings', 'suggestions', 'validation', 'workspace']
    if (!report.ok || !report.packaged || !report.sqlite || !report.lifecycle?.closed || !report.lifecycle?.activated || !report.lifecycle?.secondInstanceReused || !report.lifecycle?.api || !report.lifecycle?.settings || report.preload?.geolocation !== 'denied' || !report.security?.contextIsolation || !report.security?.sandbox || report.security?.nodeIntegration !== true || !report.navigation?.externalWindowsDenied || !report.navigation?.unexpectedNavigationBlocked || JSON.stringify(report.preload?.channels) !== JSON.stringify(expectedChannels)) {
      throw new Error(`Smoke test inválido: ${JSON.stringify(report)}`)
    }
    process.stdout.write(`Pacote validado: ${executable}\nSQLite, preload, isolamento e ciclo de vida do BrowserWindow responderam corretamente.\n`)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

function packagedExecutable() {
  const candidates = process.platform === 'win32'
    ? [path.join(releaseDirectory, 'win-unpacked', 'Nocturne Studio.exe')]
    : process.platform === 'darwin'
      ? [path.join(releaseDirectory, 'mac', 'Nocturne Studio.app', 'Contents', 'MacOS', 'Nocturne Studio'), path.join(releaseDirectory, 'mac-arm64', 'Nocturne Studio.app', 'Contents', 'MacOS', 'Nocturne Studio')]
      : [path.join(releaseDirectory, 'linux-unpacked', 'nocturne-studio')]
  const executable = candidates.find((candidate) => fs.existsSync(candidate))
  if (!executable) throw new Error(`Executável unpacked não encontrado em ${releaseDirectory}. Execute npm run package:dir ou npm run package primeiro.`)
  return executable
}

function writeChecksums() {
  if (!fs.existsSync(releaseDirectory)) throw new Error(`Diretório de release não encontrado: ${releaseDirectory}`)
  const extensions = ['.AppImage', '.dmg', '.exe', '.tar.gz', '.deb', '.zip']
  const artifacts = fs.readdirSync(releaseDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension)))
    .map((entry) => entry.name)
    .sort()
  if (!artifacts.length) throw new Error('Nenhum artefato distribuível foi encontrado para gerar checksums.')
  const lines = artifacts.map((name) => `${createHash('sha256').update(fs.readFileSync(path.join(releaseDirectory, name))).digest('hex')} *${name}`)
  fs.writeFileSync(path.join(releaseDirectory, 'SHA256SUMS'), `${lines.join('\n')}\n`, 'utf8')
  process.stdout.write(`SHA256SUMS gerado para ${artifacts.length} artefato(s).\n`)
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Tempo esgotado ao validar ${command}.\n${stderr}`)) }, 30_000)
    child.stdout.on('data', (chunk) => { stdout += chunk.toString().slice(-64_000) })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString().slice(-64_000) })
    child.on('error', (error) => { clearTimeout(timeout); reject(error) })
    child.on('exit', (code) => { clearTimeout(timeout); resolve({ code, stdout, stderr }) })
  })
}

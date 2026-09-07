import { app, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import type { LocalDatabase } from '../database/Database'

interface PackageSmokeDependencies {
  getWindow(): BrowserWindow | null
  getDatabase(): LocalDatabase | null
}

export async function runPackageSmoke(output: string, dependencies: PackageSmokeDependencies) {
  try {
    const currentWindow = dependencies.getWindow()
    const preload = await currentWindow?.webContents.executeJavaScript(`(async () => {
      const api = window.nocturne
      const geolocation = await navigator.permissions.query({ name: 'geolocation' }).then((result) => result.state).catch(() => 'denied')
      const externalWindowsDenied = window.open('about:blank', '_blank') === null
      const updateState = typeof api?.updates?.getState === 'function' ? await api.updates.getState().catch(() => null) : null
      return { available: Boolean(api), settings: typeof api?.settings?.get === 'function', updates: typeof api?.updates?.getState === 'function' && typeof api?.updates?.onStateChanged === 'function', updateState, channels: api ? Object.keys(api).sort() : [], geolocation, externalWindowsDenied }
    })()` ) as { available: boolean; settings: boolean; updates: boolean; updateState: unknown; channels: string[]; geolocation: PermissionState; externalWindowsDenied: boolean } | undefined
    const originalUrl = currentWindow?.webContents.getURL()
    await currentWindow?.webContents.executeJavaScript(`(() => {
      const link = document.createElement('a')
      link.href = 'https://example.invalid/nocturne-package-smoke'
      document.body.append(link)
      link.click()
      link.remove()
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const smokeWorkspace = app.getPath('userData')
    const database = dependencies.getDatabase()
    const conversation = database?.createConversation(smokeWorkspace)
    if (conversation) database?.addMessage(conversation.id, 'user', 'package-smoke')
    const sqlite = Boolean(conversation && database?.listMessages(conversation.id)[0]?.content === 'package-smoke')
    const lifecycle = await recreateWindowForPackageSmoke(dependencies)
    const window = dependencies.getWindow()
    const preferences = (window?.webContents as Electron.WebContents & { getLastWebPreferences(): Electron.WebPreferences } | undefined)?.getLastWebPreferences()
    const security = {
      contextIsolationEnabled: preferences?.contextIsolation === true,
      nodeIntegrationDisabled: preferences?.nodeIntegration === false,
      sandboxEnabled: preferences?.sandbox === true,
    }
    const finalUrl = window?.webContents.getURL()
    const navigation = { externalWindowsDenied: preload?.externalWindowsDenied === true, unexpectedNavigationBlocked: Boolean(originalUrl && finalUrl === originalUrl), originalUrl, finalUrl }
    const ok = Boolean(preload?.available && preload.settings && preload.updates && preload.updateState && preload.geolocation === 'denied' && sqlite && lifecycle.closed && lifecycle.activated && lifecycle.secondInstanceReused && lifecycle.api && lifecycle.settings && lifecycle.updates && security.contextIsolationEnabled && security.nodeIntegrationDisabled && security.sandboxEnabled && navigation && Object.values(navigation).every(Boolean))
    fs.writeFileSync(output, `${JSON.stringify({ ok, packaged: app.isPackaged, preload, sqlite, lifecycle, security, navigation })}\n`, { encoding: 'utf8', mode: 0o600 })
    app.quit()
  } catch (error) {
    fs.writeFileSync(output, `${JSON.stringify({ ok: false, packaged: app.isPackaged, error: error instanceof Error ? error.message : String(error) })}\n`, { encoding: 'utf8', mode: 0o600 })
    app.exit(1)
  }
}

async function recreateWindowForPackageSmoke(dependencies: PackageSmokeDependencies) {
  const previousWindow = dependencies.getWindow()
  if (!previousWindow) throw new Error('A janela do smoke não foi criada.')
  const closed = new Promise<void>((resolve) => previousWindow.once('closed', resolve))
  previousWindow.close()
  await closed
  if (typeof app.emit !== 'function') throw new Error('O harness não oferece eventos de aplicação.')
  app.emit('activate')
  const activatedWindow = dependencies.getWindow()
  if (!activatedWindow) throw new Error('O evento activate não recriou a janela do smoke.')
  await waitForWindowLoad(activatedWindow)
  app.emit('second-instance')
  const secondInstanceReused = dependencies.getWindow() === activatedWindow && !activatedWindow.isDestroyed()
  const result = await activatedWindow.webContents.executeJavaScript(`(async () => {
    const api = window.nocturne
    let settings = false
    try { await api?.settings?.get(); settings = true } catch { /* handler ausente */ }
    let updates = false
    try { await api?.updates?.getState(); updates = typeof api?.updates?.onStateChanged === 'function' } catch { /* handler ausente */ }
    return { recreated: true, api: Boolean(api), settings, updates }
  })()` ) as { recreated: boolean; api: boolean; settings: boolean; updates: boolean }
  return { closed: true, activated: result.recreated, secondInstanceReused, api: result.api, settings: result.settings, updates: result.updates }
}

async function waitForWindowLoad(window: BrowserWindow) {
  if (!window.webContents.isLoading()) return
  await new Promise<void>((resolve, reject) => {
    const onLoad = () => { cleanup(); resolve() }
    const onFail = (_event: Electron.Event, code: number, description: string) => {
      cleanup()
      reject(new Error(`A janela recriada falhou ao carregar (${code}): ${description}`))
    }
    const cleanup = () => {
      window.webContents.removeListener('did-finish-load', onLoad)
      window.webContents.removeListener('did-fail-load', onFail)
    }
    window.webContents.once('did-finish-load', onLoad)
    window.webContents.once('did-fail-load', onFail)
  })
}

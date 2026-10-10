import { app, BrowserWindow, dialog, ipcMain, Menu, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { HarnessRuntimeAdapter, type RuntimeProfileId, type RuntimeGeneration } from '@fluxyard/runtime-node'
import { bundledRuntime } from './bundled-runtime.ts'
import { DesktopService } from './service.ts'
import { WorkbenchHost } from './workbench-host.ts'
import { HarnessWebRuntime } from './web-runtime.ts'
import { electronNodeExecutable, safeDesktopError } from './security.ts'

app.setName(app.isPackaged ? 'Fluxyard' : 'Fluxyard Dev')
const smoke = process.argv.includes('--smoke')
let window: BrowserWindow | undefined
let workbench: WorkbenchHost | undefined
let activeView: 'workbench' | 'settings' = 'workbench'
let webRuntime: HarnessWebRuntime | undefined
let service: DesktopService
let quitting = false
let queue = Promise.resolve()
const executable = electronNodeExecutable(process.execPath)
let bootstrap = join(__dirname, 'harness-bootstrap.mjs')
let bundledInstallation: string | undefined
let consumerExtension: string | undefined
const indexPath = join(__dirname, 'index.html')
const indexUrl = pathToFileURL(indexPath).href
function validateSender(event: IpcMainInvokeEvent): void {
  if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== indexUrl) throw new Error('DESKTOP_IPC_FORBIDDEN')
}
function mutate(channel: string, operation: () => Promise<void>): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent) => {
    validateSender(event)
    const current = queue.catch(() => undefined).then(operation).catch(error => {
      service.error = safeDesktopError(error)
      throw new Error(service.error)
    })
    queue = current.catch(() => undefined)
    return current
  })
}
async function stopAll(): Promise<void> {
  await webRuntime?.stop()
  webRuntime = undefined
  workbench?.dispose(); workbench = undefined
  service.webState = 'stopped'
  await service.stop()
}
function showSettings(): void { activeView = 'settings'; workbench?.hide() }
async function openHarness(): Promise<void> {
  activeView = 'workbench'
  if (workbench && webRuntime?.running && service.webState === 'ready') { workbench.show(); return }
  await stopAll()
  const config = await service.config()
  service.error = undefined
  service.webState = 'starting'
  const fault = () => {
    workbench?.hide()
    service.webState = 'failed'
    service.error = 'HARNESS_WEB_START_FAILED'
  }
  webRuntime = new HarnessWebRuntime(executable, bootstrap, fault, consumerExtension)
  try {
    // Keep the established Web home so upgrading the shell preserves sessions.
    const { url, port } = await webRuntime.start({ ...config, homeDirectory: `${config.homeDirectory}-web` })
    workbench = new WorkbenchHost(window!, port, fault)
    await workbench.load(url)
    if (!webRuntime.running) throw new Error('HARNESS_WEB_START_FAILED')
    service.webState = 'ready'
    if (activeView === 'workbench') workbench.show()
  } catch (error) { await stopAll(); service.webState = 'failed'; throw error }
}

async function main(): Promise<void> {
if (!smoke && !app.requestSingleInstanceLock()) { app.quit(); return }
if (!smoke && process.env.FLUXYARD_DESKTOP_DATA) {
  await mkdir(process.env.FLUXYARD_DESKTOP_DATA, { recursive: true, mode: 0o700 })
  app.setPath('userData', process.env.FLUXYARD_DESKTOP_DATA)
}
await app.whenReady()
if (app.isPackaged) {
  const bundled = await bundledRuntime(process.resourcesPath, { electron: process.versions.electron, platform: process.platform, arch: process.arch })
  bootstrap = bundled.bootstrap
  bundledInstallation = bundled.installation
  consumerExtension = join(bundled.installation, 'node_modules/@fluxyard/harness-extensions/index.mjs')
}
if (smoke) {
  const scratch = await mkdtemp(join(tmpdir(), 'fluxyard-electron-'))
  try {
    const installation = bundledInstallation ?? process.env.FLUXYARD_HARNESS_INSTALLATION
    if (!installation) throw new Error('HARNESS_NOT_INSTALLED')
    const adapter = new HarnessRuntimeAdapter({ nodeExecutable: executable, nodeArguments: ['--expose-internals', bootstrap], environment: { PATH: process.env.PATH, HOME: scratch, ELECTRON_RUN_AS_NODE: '1' }, startupTimeoutMs: 30_000 })
    const handle = await adapter.start({
      profile: { id: 'electron-smoke' as RuntimeProfileId, displayName: 'Electron carrier acceptance', adapterKind: adapter.kind, crashThreshold: 3, createdAt: new Date().toISOString(), config: { cliEntry: join(installation, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), workingDirectory: scratch, homeDirectory: join(scratch, 'sdk-home'), provider: 'deepseek-official', model: 'deepseek-official' } },
      generation: 1 as RuntimeGeneration, onHeartbeat: () => {}, onExit: () => {},
    })
    const pid = handle.pid
    const sdkVersion = handle.serverVersion
    await handle.stop('smoke complete')
    const web = new HarnessWebRuntime(executable, bootstrap, undefined, consumerExtension)
    try {
      const endpoint = await web.start({ cliEntry: join(installation, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), workingDirectory: scratch, homeDirectory: join(scratch, 'web-home'), provider: 'deepseek-official', model: 'deepseek-official' })
      const response = await fetch(endpoint.url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
      const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
      if (!cookie) throw new Error('HARNESS_WEB_START_FAILED')
      const page = await fetch(new URL('/', endpoint.url), { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10_000) })
      if (!page.ok || !(await page.text()).includes('<html')) throw new Error('HARNESS_WEB_START_FAILED')
      if (consumerExtension) {
        const origin = new URL(endpoint.url).origin
        const extension = await fetch(new URL('/fluxyard/ppt', endpoint.url), { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read', sessionId: 'missing-smoke-session' }), signal: AbortSignal.timeout(10_000) })
        if (extension.status !== 400 || !(await extension.text()).includes('会话状态')) throw new Error('HARNESS_WEB_START_FAILED')
      }
      console.log(JSON.stringify({ ok: true, electron: process.versions.electron, node: process.versions.node, executable, sdkVersion, pid, sdkStopped: true, webHttpStatus: page.status, consumerExtensionLoaded: Boolean(consumerExtension), standaloneNode: false, modelCalls: 0 }))
    } finally { await web.stop() }
    process.exitCode = 0
  } catch (error) { console.error(JSON.stringify({ ok: false, code: safeDesktopError(error) })); process.exitCode = 1 }
  finally { await rm(scratch, { recursive: true, force: true }) }
  app.exit(process.exitCode ?? 0)
} else {
  service = await DesktopService.open(app.getPath('userData'), executable, bootstrap)
  if (bundledInstallation) await service.useBundledInstallation(bundledInstallation)
  else if (process.env.FLUXYARD_HARNESS_INSTALLATION) await service.chooseInstallation(process.env.FLUXYARD_HARNESS_INSTALLATION)
  window = new BrowserWindow({ width: 1240, height: 850, minWidth: 900, minHeight: 640, backgroundColor: '#f5f6fa', title: 'Fluxyard', ...(process.platform === 'darwin' && app.isPackaged ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 16, y: 18 }, vibrancy: 'sidebar' as const, visualEffectState: 'active' as const } : {}), webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } })
  // Consumer commands live in the OS menu; the conversation UI owns preferences.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'Fluxyard', submenu: [{ role: 'about' as const }, { type: 'separator' as const }, { role: 'hide' as const }, { role: 'hideOthers' as const }, { role: 'unhide' as const }, { type: 'separator' as const }, { role: 'quit' as const }] }] : []),
    { role: 'editMenu' },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'togglefullscreen' }] },
    { label: '帮助', submenu: [
      { label: '返回会话', click: () => { queue = queue.catch(() => undefined).then(openHarness).catch(error => { service.error = safeDesktopError(error) }) } },
      { label: '连接诊断', click: showSettings },
    ] },
  ]))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  ipcMain.handle('fluxyard:overview', async (event: IpcMainInvokeEvent) => {
    validateSender(event)
    if (service.webState === 'ready' && !webRuntime?.running) { workbench?.hide(); service.webState = 'failed'; service.error = 'HARNESS_WEB_START_FAILED' }
    return { ...service.runtimeOverview(), activeView, carrier: { electron: process.versions.electron, node: process.versions.node, platform: process.platform } }
  })
  mutate('fluxyard:installation', async () => {
    if (bundledInstallation) throw new Error('BUNDLED_RUNTIME_MANAGED')
    const selected = await dialog.showOpenDialog(window!, { title: 'Choose Harness npm installation directory', properties: ['openDirectory'] })
    if (!selected.canceled && selected.filePaths[0]) await service.chooseInstallation(selected.filePaths[0])
  })
  mutate('fluxyard:workspace', async () => {
    const selected = await dialog.showOpenDialog(window!, { title: 'Choose Agent workspace', properties: ['openDirectory', 'createDirectory'] })
    if (!selected.canceled && selected.filePaths[0]) { await stopAll(); await service.chooseWorkspace(selected.filePaths[0]) }
  })
  mutate('fluxyard:start', async () => { await stopAll(); showSettings(); await service.start() })
  mutate('fluxyard:stop', stopAll)
  mutate('fluxyard:recover', () => service.recover())
  mutate('fluxyard:harness', openHarness)
  mutate('fluxyard:settings', async () => showSettings())
  await window.loadFile(indexPath)
  if (service.runtimeOverview().installation) {
    queue = openHarness().catch(error => { service.error = safeDesktopError(error) })
  } else showSettings()
  app.on('second-instance', () => { window?.show(); window?.focus() })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void queue.then(stopAll).then(() => app.quit()).catch(() => app.exit(1))
  })
}

}
void main().catch(error => { console.error(safeDesktopError(error)); app.exit(1) })

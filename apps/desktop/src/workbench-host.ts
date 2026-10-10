import { app, BrowserWindow, WebContentsView } from 'electron'
import { join } from 'node:path'
import { isLocalHarnessUrl } from './security.ts'
import { workbenchBounds } from './workbench-layout.ts'
/** One window, with separate authority for the trusted shell and agent UI. */
export class WorkbenchHost {
  private readonly view: WebContentsView
  private attached = false
  private readonly window: BrowserWindow
  constructor(window: BrowserWindow, port: number, onFault: () => void) {
    this.window = window
    this.view = new WebContentsView({ webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'persist:fluxyard-personal', preload: join(__dirname, 'workbench-preload.cjs'), additionalArguments: app.isPackaged ? ['--fluxyard-native-layout'] : [] } })
    const contents = this.view.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event, target) => { if (!isLocalHarnessUrl(target, port)) event.preventDefault() })
    contents.on('will-redirect', (event, target) => { if (!isLocalHarnessUrl(target, port)) event.preventDefault() })
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    contents.on('render-process-gone', onFault)
    contents.on('did-finish-load', this.syncFullscreen)
    window.on('enter-full-screen', this.syncFullscreen)
    window.on('leave-full-screen', this.syncFullscreen)
    window.on('resize', this.resize)
  }
  async load(url: string): Promise<void> { await this.view.webContents.loadURL(url) }
  show(): void {
    if (!this.attached) { this.window.contentView.addChildView(this.view); this.attached = true }
    this.resize()
  }
  hide(): void {
    if (this.attached && !this.window.isDestroyed()) this.window.contentView.removeChildView(this.view)
    this.attached = false
  }
  dispose(): void {
    this.hide()
    this.window.off('resize', this.resize)
    this.window.off('enter-full-screen', this.syncFullscreen)
    this.window.off('leave-full-screen', this.syncFullscreen)
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close()
  }
  private readonly syncFullscreen = (): void => {
    if (!this.window.isDestroyed() && !this.view.webContents.isDestroyed()) this.view.webContents.send('fluxyard:window-fullscreen', this.window.isFullScreen())
  }
  private readonly resize = (): void => {
    if (this.window.isDestroyed()) return
    const [width, height] = this.window.getContentSize()
    this.view.setBounds(workbenchBounds(width, height))
  }
}

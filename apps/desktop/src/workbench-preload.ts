import { ipcRenderer } from 'electron'
// Presentation only: no contextBridge, filesystem access or callable IPC API.
// Harness ships native macOS layout selectors; set them before modules mount.
if (process.platform === 'darwin' && process.argv.includes('--fluxyard-native-layout')) {
  let fullscreen = false
  const mark = (): void => {
    const root = document.documentElement
    if (!root) return
    root.dataset.dshDesktopWebShortcuts = 'true'
    root.dataset.platform = 'darwin'
    if (fullscreen) root.dataset.fullscreen = 'true'
    else delete root.dataset.fullscreen
  }
  mark()
  document.addEventListener('DOMContentLoaded', mark, { once: true })
  ipcRenderer.on('fluxyard:window-fullscreen', (_event, value: unknown) => {
    if (typeof value !== 'boolean') return
    fullscreen = value
    mark()
  })
}

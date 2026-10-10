import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge } from './contracts.ts'
const bridge: DesktopBridge = {
  overview: () => ipcRenderer.invoke('fluxyard:overview'),
  chooseInstallation: () => ipcRenderer.invoke('fluxyard:installation'),
  chooseWorkspace: () => ipcRenderer.invoke('fluxyard:workspace'),
  start: () => ipcRenderer.invoke('fluxyard:start'),
  stop: () => ipcRenderer.invoke('fluxyard:stop'),
  recover: () => ipcRenderer.invoke('fluxyard:recover'),
  showSettings: () => ipcRenderer.invoke('fluxyard:settings'),
  openHarness: () => ipcRenderer.invoke('fluxyard:harness'),
}
contextBridge.exposeInMainWorld('fluxyard', bridge)

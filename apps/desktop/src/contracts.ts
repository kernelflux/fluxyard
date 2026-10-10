import type { RuntimeProfileState } from '@fluxyard/runtime-node'
export interface DesktopOverview {
  readonly carrier: { electron: string; node: string; platform: string }
  readonly activeView?: 'workbench' | 'settings'
  readonly bundledRuntime?: boolean
  readonly installation?: string
  readonly workspace: string
  readonly selectedProfileId?: string
  readonly profiles: readonly RuntimeProfileState[]
  readonly inventory?: readonly { name: string; agents: number; nodes: number; tokens: number; costMicros: number }[]
  readonly webState: 'stopped' | 'starting' | 'ready' | 'failed'
  readonly error?: string
}
export interface DesktopBridge {
  overview(): Promise<DesktopOverview>
  chooseInstallation(): Promise<void>
  chooseWorkspace(): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
  recover(): Promise<void>
  openHarness(): Promise<void>
  showSettings(): Promise<void>
}
declare global { interface Window { fluxyard: DesktopBridge } }

import { createHash } from 'node:crypto'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { JsonControlPlaneStore } from '@fluxyard/store-json'
import { HarnessRuntimeAdapter, JsonRuntimeNodeStateStore, RuntimeNodeSupervisor, type HarnessLaunchConfig, type RuntimeProfileId } from '@fluxyard/runtime-node'
import type { DesktopOverview } from './contracts.ts'
import { safeDesktopError } from './security.ts'

interface Settings { installation?: string; workspace: string }
export class DesktopService {
  private settings: Settings
  private bundledInstallation?: string
  private supervisor!: RuntimeNodeSupervisor
  error?: string
  webState: DesktopOverview['webState'] = 'stopped'
  private readonly settingsPath: string
  private readonly ledger: JsonControlPlaneStore
  readonly dataDirectory: string
  readonly executable: string
  readonly bootstrap: string
  private constructor(dataDirectory: string, executable: string, bootstrap: string, settings: Settings) {
    this.dataDirectory = dataDirectory
    this.executable = executable
    this.bootstrap = bootstrap
    this.settings = settings
    this.settingsPath = join(dataDirectory, 'desktop-settings.json')
    this.ledger = new JsonControlPlaneStore(process.env.FLUXYARD_CONTROL_PLANE_DATA ?? join(dataDirectory, 'control-plane.json'))
  }
  static async open(dataDirectory: string, executable: string, bootstrap: string): Promise<DesktopService> {
    await mkdir(dataDirectory, { recursive: true, mode: 0o700 })
    const workspace = join(dataDirectory, 'workspace')
    await mkdir(workspace, { recursive: true, mode: 0o700 })
    let settings: Settings = { workspace }
    try {
      const saved: unknown = JSON.parse(await readFile(join(dataDirectory, 'desktop-settings.json'), 'utf8'))
      if (!saved || typeof saved !== 'object' || typeof (saved as Settings).workspace !== 'string' || ((saved as Settings).installation !== undefined && typeof (saved as Settings).installation !== 'string')) throw new Error('DESKTOP_SETTINGS_INVALID')
      settings = saved as Settings
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const service = new DesktopService(dataDirectory, executable, bootstrap, settings)
    const harness = new HarnessRuntimeAdapter({ nodeExecutable: executable, nodeArguments: ['--expose-internals', bootstrap], environment: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, onFault: error => { service.error = safeDesktopError(error) } })
    service.supervisor = await RuntimeNodeSupervisor.open({
      store: new JsonRuntimeNodeStateStore(join(dataDirectory, 'runtime-node.json')),
      adapters: [{ kind: harness.kind, start: request => {
        if (request.profile.config.cliEntry !== 'bundled:@deepseek-ai/dsh:0.2.0-rc.2') return harness.start(request)
        if (!service.bundledInstallation) throw new Error('BUNDLED_RUNTIME_INVALID')
        return harness.start({ ...request, profile: { ...request.profile, config: { ...request.profile.config, cliEntry: join(service.bundledInstallation, 'node_modules/@deepseek-ai/dsh/lib/bin.js') } } })
      } }],
    })
    return service
  }
  async useBundledInstallation(directory: string): Promise<void> {
    this.requireStopped()
    await this.validateInstallation(directory)
    this.bundledInstallation = directory
    this.settings = { ...this.settings, installation: directory }
  }
  async chooseInstallation(directory: string): Promise<void> {
    if (this.bundledInstallation) throw new Error('BUNDLED_RUNTIME_MANAGED')
    this.requireStopped()
    await this.validateInstallation(directory)
    await this.saveSettings({ ...this.settings, installation: directory })
    this.error = undefined
  }
  async chooseWorkspace(directory: string): Promise<void> {
    this.requireStopped()
    await access(directory)
    await this.saveSettings({ ...this.settings, workspace: directory })
  }
  async config(): Promise<HarnessLaunchConfig> {
    if (!this.settings.installation) throw new Error('HARNESS_NOT_INSTALLED')
    await this.validateInstallation(this.settings.installation)
    return { cliEntry: join(this.settings.installation, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), workingDirectory: this.settings.workspace, homeDirectory: join(this.dataDirectory, 'profiles', this.profileId()), provider: 'deepseek-official', model: 'deepseek-official' }
  }
  private async validateInstallation(directory: string): Promise<void> {
    const root = join(directory, 'node_modules/@deepseek-ai/dsh')
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { name?: string; version?: string }
    if (manifest.name !== '@deepseek-ai/dsh' || manifest.version !== '0.2.0-rc.2') throw new Error('HARNESS_VERSION_INVALID')
    await access(join(root, 'lib/bin.js'))
  }
  async start(): Promise<void> {
    this.requireStopped()
    const config = await this.config()
    const id = this.profileId()
    const existing = this.supervisor.listProfiles().find(profile => profile.definition.id === id)
    await this.supervisor.registerProfile({ id, displayName: 'Local Harness', adapterKind: 'deepseek-harness', crashThreshold: 3, config: { ...config, cliEntry: this.bundledInstallation ? 'bundled:@deepseek-ai/dsh:0.2.0-rc.2' : config.cliEntry }, createdAt: existing?.definition.createdAt ?? new Date().toISOString() })
    const state = await this.supervisor.start(id)
    this.error = state.status === 'healthy' ? undefined : 'HARNESS_START_FAILED'
    if (state.status !== 'healthy') throw new Error('HARNESS_START_FAILED')
  }
  async stop(): Promise<void> {
    for (const profile of this.supervisor.listProfiles()) {
      if (['healthy', 'unhealthy'].includes(profile.status)) await this.supervisor.stop(profile.definition.id)
    }
    this.error = undefined
  }
  async recover(): Promise<void> { await this.supervisor.recoverSafeMode(this.profileId()); this.error = undefined }
  runtimeOverview(): Omit<DesktopOverview, 'carrier' | 'inventory'> {
    return { installation: this.settings.installation, bundledRuntime: Boolean(this.bundledInstallation), workspace: this.settings.workspace,
      selectedProfileId: this.profileId(), profiles: this.supervisor.listProfiles(), webState: this.webState, error: this.error }
  }
  async overview(): Promise<Omit<DesktopOverview, 'carrier'>> {
    const plane = await this.ledger.load()
    return {
      ...this.runtimeOverview(),
      inventory: plane.listWorkspaces().map(workspace => {
        const usage = plane.summarizeUsage({ workspaceId: workspace.id })
        return { name: workspace.name, agents: plane.listAgents(workspace.id).length, nodes: plane.listRuntimeNodes(workspace.id).length, tokens: usage.inputTokens + usage.outputTokens, costMicros: usage.costMicros }
      }),
    }
  }
  private profileId(): RuntimeProfileId {
    return `harness-${createHash('sha256').update(JSON.stringify([this.bundledInstallation ? 'bundled:@deepseek-ai/dsh:0.2.0-rc.2' : this.settings.installation, this.settings.workspace])).digest('hex').slice(0, 16)}` as RuntimeProfileId
  }
  private requireStopped(): void {
    if (['starting', 'ready'].includes(this.webState) || this.supervisor.listProfiles().some(profile => ['starting', 'healthy', 'unhealthy'].includes(profile.status))) throw new Error('DESKTOP_RUNTIME_BUSY')
  }
  private async saveSettings(settings: Settings): Promise<void> {
    await writeFile(`${this.settingsPath}.tmp`, JSON.stringify(settings, null, 2), { mode: 0o600 })
    await rename(`${this.settingsPath}.tmp`, this.settingsPath)
    this.settings = settings
  }
}

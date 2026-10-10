import type { DesktopOverview } from './contracts.ts'
const element = (id: string) => document.getElementById(id)!
let busy = false
function errorMessage(code: string): string {
  const messages: Record<string, string> = {
    HARNESS_NOT_INSTALLED: '开发模式下，请先在诊断信息中选择 Harness 安装目录。正式应用会使用内置运行时。',
    HARNESS_VERSION_INVALID: '当前开发运行时版本不兼容，需要 @deepseek-ai/dsh 0.2.0-rc.2。',
    HARNESS_START_FAILED: 'SDK 就绪检查未通过。可以重新连接工作台，或检查诊断信息。',
    HARNESS_WEB_START_FAILED: '本地工作台连接中断。请重新连接；已有会话和文件会保留。',
    DESKTOP_RUNTIME_BUSY: '当前连接正在运行，请先停止连接。',
    RUNTIME_TRANSITION_INVALID: '当前 SDK 不处于安全模式，无需恢复。',
    BUNDLED_RUNTIME_INVALID: '应用运行资源校验失败，请重新安装完整应用。',
  }
  return messages[code] ?? '操作未完成，请重试。已有工作区记录会保留。'
}
function render(value: DesktopOverview): void {
  const settings = value.activeView === 'settings'
  element('settings').classList.toggle('hidden', !settings)
  const active = value.profiles.find(profile => profile.definition.id === value.selectedProfileId)
  const starting = value.webState === 'starting'
  const ready = value.webState === 'ready'
  const recovery = Boolean(value.error) || !value.installation
  element('welcome').classList.toggle('hidden', settings || ready || !recovery)
  element('loading').classList.toggle('hidden', settings || ready || recovery)
  element('connection').textContent = starting ? '正在连接…' : ready ? '本地连接已就绪' : '本地连接未启动'
  element('connection').classList.toggle('ready', ready)
  element('welcome-title').textContent = value.error ? '工作台需要重新连接。' : starting ? '正在准备你的工作台。' : '你的工作，从这里开始。'
  element('welcome-description').textContent = value.error ? errorMessage(value.error) : starting ? '正在启动本地服务，通常只需几秒钟。' : !value.installation ? '先完成本地配置，即可开始新的会话。' : '会话、项目和模型设置都在同一个工作台里。'
  element('workspace').textContent = value.workspace
  element('installation').textContent = value.bundledRuntime ? '内置运行时 · DeepSeek Harness 0.2.0-rc.2' : value.installation ?? '尚未配置开发运行时'
  element('runtime-description').textContent = value.bundledRuntime ? '使用应用内置运行时，无需安装 Node 或 npm。' : '开发模式使用指定的 Harness 包目录。'
  element('carrier').textContent = `Electron ${value.carrier.electron} · Node ${value.carrier.node} · ${value.carrier.platform}`
  element('status').textContent = ready ? '已连接' : starting ? '连接中' : active?.status === 'healthy' ? 'SDK 已就绪' : '未连接'
  element('generation').textContent = active ? String(active.generation) : '—'
  element('heartbeat').textContent = active?.lastHeartbeatAt ? new Date(active.lastHeartbeatAt).toLocaleTimeString() : '—'
  element('error').textContent = value.error ? errorMessage(value.error) : ''
  element('error').classList.toggle('hidden', !value.error)
  const sdkRunning = value.profiles.some(profile => ['healthy', 'starting', 'unhealthy'].includes(profile.status))
  for (const id of ['retry', 'settings-workbench', 'restart']) (element(id) as HTMLButtonElement).disabled = busy || starting || !value.installation
  ;(element('choose-installation') as HTMLButtonElement).classList.toggle('hidden', Boolean(value.bundledRuntime))
  ;(element('choose-installation') as HTMLButtonElement).disabled = busy || sdkRunning || ready || starting
  ;(element('choose-workspace') as HTMLButtonElement).disabled = busy || starting
  ;(element('start') as HTMLButtonElement).disabled = busy || starting || sdkRunning || !value.installation || active?.status === 'safe-mode'
  ;(element('stop') as HTMLButtonElement).disabled = busy || !(ready || starting || sdkRunning)
  ;(element('recover') as HTMLButtonElement).disabled = busy || active?.status !== 'safe-mode'
}
async function refresh(): Promise<void> { render(await window.fluxyard.overview()) }
function bind(id: string, operation: () => Promise<void>): void {
  element(id).addEventListener('click', async () => {
    if (busy) return
    busy = true
    try { await operation() } catch { /* Safe, token-free errors arrive in the next snapshot. */ }
    finally { busy = false; await refresh().catch(() => { element('connection').textContent = '连接暂时不可用' }) }
  })
}
for (const id of ['retry', 'settings-workbench']) bind(id, () => window.fluxyard.openHarness())
for (const id of ['welcome-settings']) bind(id, () => window.fluxyard.showSettings())
bind('restart', async () => { await window.fluxyard.stop(); await window.fluxyard.openHarness() })
bind('choose-installation', () => window.fluxyard.chooseInstallation())
bind('choose-workspace', () => window.fluxyard.chooseWorkspace())
bind('start', () => window.fluxyard.start())
bind('stop', () => window.fluxyard.stop())
bind('recover', () => window.fluxyard.recover())
void refresh().catch(() => { element('connection').textContent = '正在恢复连接' })
setInterval(() => { if (!busy) void refresh().catch(() => { element('connection').textContent = '连接暂时不可用' }) }, 1_000)

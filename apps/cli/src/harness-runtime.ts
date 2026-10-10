import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { HarnessRuntimeAdapter, JsonRuntimeNodeStateStore, RuntimeNodeSupervisor, reduceRuntimeProfile, validateRuntimeProfileState, parseHarnessConfig, type RuntimeAdapterStartRequest, type RuntimeProfileId } from '@fluxyard/runtime-node'

export async function runHarnessRuntime(
  action: string | undefined,
  values: readonly string[],
  dataPath: string,
  write: (line: string) => void,
  environment: NodeJS.ProcessEnv,
): Promise<number> {
  const maintenance = action === 'status' || action === 'recover'
  if (!['doctor', 'start', 'status', 'recover'].includes(action ?? '') || values.length !== (maintenance ? 0 : 1)) {
    throw new Error('usage: runtime harness <doctor|start> <launch-config.json> | <status|recover>')
  }
  if (maintenance) {
    const store = new JsonRuntimeNodeStateStore(dataPath)
    const snapshot = await store.load()
    for (const profile of snapshot.profiles) validateRuntimeProfileState(profile)
    if (action === 'status') {
      write(JSON.stringify({ ok: true, dataPath, result: snapshot.profiles }))
      return 0
    }
    const profile = snapshot.profiles.find(entry => entry.definition.id === 'harness-local')
    if (!profile) throw new Error('RUNTIME_PROFILE_NOT_FOUND')
    const result = reduceRuntimeProfile(profile, { type: 'recover-safe-mode', at: new Date().toISOString() })
    await store.save({ ...snapshot, profiles: snapshot.profiles.map(entry => entry === profile ? result : entry) })
    write(JSON.stringify({ ok: true, dataPath, result }))
    return 0
  }
  const config = parseHarnessConfig(JSON.parse(await readFile(values[0]!, 'utf8')))
  if (action === 'doctor') {
    const { stdout } = await promisify(execFile)(config.nodeExecutable ?? process.execPath, [config.cliEntry, '--version'], {
      cwd: config.workingDirectory,
      env: { ...environment, DSH_HOME: config.homeDirectory, DSH_TELEMETRY_MODE: 'DISABLED' },
      timeout: 10_000, maxBuffer: 4096,
    }).catch(() => { throw new Error('HARNESS_DOCTOR_FAILED: launcher version check failed') })
    const version = stdout.trim()
    if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.+-]+)?$/.test(version)) throw new Error('HARNESS_VERSION_INVALID')
    const { stdout: nodeVersion } = await promisify(execFile)(config.nodeExecutable ?? process.execPath, ['--version'], { timeout: 10_000, maxBuffer: 4096 })
    write(JSON.stringify({ ok: true, version, node: nodeVersion.trim(), config, readinessVerified: false }))
    return 0
  }
  const adapter = new HarnessRuntimeAdapter({ environment, onFault: () => write(JSON.stringify({ ok: false, error: 'RUNTIME_CALLBACK_FAILED' })) })
  let runtimeInfo: { pid: number | undefined; sdkVersion: string } | undefined
  const observedAdapter = {
    kind: adapter.kind,
    async start(request: RuntimeAdapterStartRequest) {
      const handle = await adapter.start(request)
      runtimeInfo = { pid: handle.pid, sdkVersion: handle.serverVersion }
      return handle
    },
  }
  const supervisor = await RuntimeNodeSupervisor.open({ store: new JsonRuntimeNodeStateStore(dataPath), adapters: [observedAdapter] })
  const id = 'harness-local' as RuntimeProfileId
  const existing = supervisor.listProfiles().find(profile => profile.definition.id === id)
  await supervisor.registerProfile({
    id, displayName: 'Local DeepSeek Harness', adapterKind: adapter.kind,
    crashThreshold: 3, config: { ...config }, createdAt: existing?.definition.createdAt ?? new Date().toISOString(),
  })
  let stopRequested = false
  const stop = () => { stopRequested = true }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  let started = false
  try {
    const state = await supervisor.start(id)
    started = state.status === 'healthy'
    write(JSON.stringify({ ok: started, dataPath, profile: state, runtime: runtimeInfo }))
    if (!started) return 1
    // Remain the owning foreground host. No detached, unowned CLI daemon.
    while (!stopRequested && ['healthy', 'unhealthy'].includes(supervisor.getProfile(id).status)) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (!stopRequested) return 1
    return 0
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
    if (started && ['healthy', 'unhealthy'].includes(supervisor.getProfile(id).status)) {
      const stopped = await supervisor.stop(id)
      write(JSON.stringify({ ok: true, profile: stopped }))
    }
  }
}

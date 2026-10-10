/** Opt-in real runtime acceptance. No prompts, credentials or model calls. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  HarnessRuntimeAdapter, JsonRuntimeNodeStateStore, RuntimeNodeSupervisor,
  parseHarnessConfig, type RuntimeAdapterStartRequest, type RuntimeProcessHandle, type RuntimeProfileId,
} from '../packages/runtime-node/src/index.ts'

const configPath = process.argv[2]
if (!configPath) throw new Error('usage: pnpm smoke:harness /path/to/harness-launch.json')
const launch = parseHarnessConfig(JSON.parse(await readFile(configPath, 'utf8')))
const temporary = await mkdtemp(join(tmpdir(), 'fluxyard-real-harness-'))
const faults: unknown[] = []
const config = { ...launch, workingDirectory: temporary, homeDirectory: join(temporary, 'home') }
const environment = { PATH: process.env.PATH, HOME: temporary, SystemRoot: process.env.SystemRoot }
let active: RuntimeProcessHandle | undefined
const runtime = new HarnessRuntimeAdapter({ environment, heartbeatIntervalMs: 100, onFault: error => faults.push(error) })
// Capture observability without making the runtime-neutral supervisor depend on PIDs.
const adapter = {
  kind: runtime.kind,
  async start(request: RuntimeAdapterStartRequest) {
    const handle = await runtime.start(request)
    active = handle
    return handle
  },
}
const id = 'harness-smoke' as RuntimeProfileId
const statePath = join(temporary, 'node-state.json')
const store = new JsonRuntimeNodeStateStore(statePath)
const supervisor = await RuntimeNodeSupervisor.open({ store, adapters: [adapter] })
const waitFor = async (check: () => boolean) => {
  const deadline = Date.now() + 10_000
  while (!check()) {
    assert.ok(Date.now() < deadline, 'runtime lifecycle observation timed out')
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}
try {
  const { stdout } = await promisify(execFile)(config.nodeExecutable ?? process.execPath, [config.cliEntry, '--version'], {
    env: environment, cwd: temporary, timeout: 10_000, maxBuffer: 4096,
  })
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+/)
  await supervisor.registerProfile({ id, displayName: 'Official Harness acceptance', adapterKind: runtime.kind, crashThreshold: 3, config, createdAt: new Date().toISOString() })
  const startedAt = Date.now()
  assert.equal((await supervisor.start(id)).status, 'healthy')
  const startupMs = Date.now() - startedAt
  const initialHeartbeat = supervisor.getProfile(id).lastHeartbeatAt!
  await waitFor(() => Date.parse(supervisor.getProfile(id).lastHeartbeatAt!) > Date.parse(initialHeartbeat))
  const handle = active as import('../packages/runtime-node/src/index.ts').HarnessRuntimeProcess
  const pid = handle.pid!
  const sdkVersion = handle.serverVersion
  assert.equal((await supervisor.stop(id)).status, 'stopped')
  assert.throws(() => process.kill(pid, 0), 'stopped runtime still exists')
  const reopened = await RuntimeNodeSupervisor.open({ store, adapters: [adapter] })
  assert.equal(reopened.getProfile(id).status, 'stopped')

  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.equal((await reopened.start(id)).status, 'healthy')
    process.kill((active as import('../packages/runtime-node/src/index.ts').HarnessRuntimeProcess).pid!, 'SIGKILL')
    await waitFor(() => ['crashed', 'safe-mode'].includes(reopened.getProfile(id).status))
    assert.equal(reopened.getProfile(id).consecutiveCrashes, attempt)
  }
  assert.equal(reopened.getProfile(id).status, 'safe-mode')
  const recoveredHost = await RuntimeNodeSupervisor.open({ store, adapters: [adapter] })
  assert.equal(recoveredHost.getProfile(id).status, 'safe-mode')
  await assert.rejects(() => recoveredHost.start(id), /RUNTIME_START_NOT_ALLOWED/)
  assert.equal((await recoveredHost.recoverSafeMode(id)).status, 'stopped')
  assert.equal((await recoveredHost.start(id)).status, 'healthy')
  assert.equal((await recoveredHost.stop(id)).status, 'stopped')
  const brokenHome = join(temporary, 'broken-home')
  const brokenProfile = join(brokenHome, 'profiles', 'sdk')
  await mkdir(brokenProfile, { recursive: true })
  await writeFile(join(brokenProfile, 'package.json'), JSON.stringify({ name: 'fluxyard-broken-profile', private: true, 'dsh.profile': { bundles: ['@fluxyard/missing-smoke-bundle'] } }))
  await writeFile(join(brokenProfile, 'cordis.patch.yml'), '[]\n')
  const brokenId = 'harness-broken' as RuntimeProfileId
  await recoveredHost.registerProfile({ id: brokenId, displayName: 'Missing plugin acceptance', adapterKind: runtime.kind, crashThreshold: 1, config: { ...config, homeDirectory: brokenHome }, createdAt: new Date().toISOString() })
  const broken = await recoveredHost.start(brokenId)
  assert.equal(broken.status, 'safe-mode', 'missing plugin must not report healthy')
  assert.equal(broken.consecutiveCrashes, 1, 'startup failure was counted more than once')
  assert.match(broken.lastExit?.reason ?? '', /HARNESS_START_FAILED/)
  assert.equal(faults.length, 0, 'adapter emitted lifecycle callback failures')
  console.log(JSON.stringify({ ok: true, harnessVersion: stdout.trim(), sdkVersion, startupMs, checks: ['initialize', 'heartbeat', 'normal-stop', 'pid-reaped', 'durable-state', 'three-real-crashes', 'persisted-safe-mode', 'explicit-recovery', 'missing-plugin-failure'], modelCalls: 0 }, null, 2))
} finally {
  await active?.stop('acceptance cleanup')
  await rm(temporary, { recursive: true, force: true })
}

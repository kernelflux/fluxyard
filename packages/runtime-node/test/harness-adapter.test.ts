import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HarnessRuntimeAdapter, parseHarnessConfig, type RuntimeAdapterStartRequest, type RuntimeGeneration, type RuntimeProfileId, type RuntimeProcessHandle } from '../src/index.ts'
const entry = fileURLToPath(new URL('./fixtures/sdk-process.mjs', import.meta.url))
const resources: { directory: string; handle?: RuntimeProcessHandle }[] = []
afterEach(async () => { for (const resource of resources.splice(0)) { await resource.handle?.stop('cleanup'); await rm(resource.directory, { recursive: true, force: true }) } })
async function fixture(mode = 'normal') {
  const directory = await mkdtemp(join(tmpdir(), 'fluxyard-harness-'))
  const resource: typeof resources[number] = { directory }
  resources.push(resource)
  const heartbeat = vi.fn()
  const exit = vi.fn()
  const request: RuntimeAdapterStartRequest = {
    profile: { id: 'harness-test' as RuntimeProfileId, displayName: 'test', adapterKind: 'deepseek-harness', crashThreshold: 3, createdAt: new Date().toISOString(), config: { cliEntry: entry, workingDirectory: directory, homeDirectory: join(directory, 'home'), provider: 'deepseek-official', model: 'deepseek-official' } },
    generation: 1 as RuntimeGeneration, onHeartbeat: heartbeat, onExit: exit,
  }
  const adapter = new HarnessRuntimeAdapter({ environment: { ...process.env, FLUXYARD_FIXTURE_MODE: mode }, startupTimeoutMs: 500, heartbeatIntervalMs: 20, stopTimeoutMs: 50 })
  return { request, adapter, heartbeat, exit, resource }
}
describe('external Harness SDK adapter', () => {
  it('handshakes through fragmented frames, isolates home and stops without counting a crash', async () => {
    const { adapter, request, heartbeat, exit, resource } = await fixture()
    const handle = resource.handle = await adapter.start(request)
    expect(handle.pid).toBeGreaterThan(0)
    expect(handle.serverVersion).toBe('0.0.1')
    expect(await handle.rpc('test', {})).toMatchObject({ home: await realpath(request.profile.config.homeDirectory as string) })
    await vi.waitFor(() => expect(heartbeat).toHaveBeenCalled())
    await handle.stop('normal')
    await handle.stop('repeat')
    expect(exit).not.toHaveBeenCalled()
    await expect(handle.rpc('test', {})).rejects.toThrow('HARNESS_NOT_RUNNING')
  })
  it.each(['silent', 'wrong', 'reject', 'early-exit'])('cleans up startup failure: %s', async mode => {
    const { adapter, request, exit } = await fixture(mode)
    await expect(adapter.start(request)).rejects.toThrow('HARNESS_START_FAILED')
    expect(exit).not.toHaveBeenCalled()
    // Home ownership must be released even after failed initialization.
    await expect(adapter.start(request)).rejects.toThrow('HARNESS_START_FAILED')
  })
  it('reports unexpected exit with a generation callback', async () => {
    const { adapter, request, exit, resource } = await fixture('crash')
    resource.handle = await adapter.start(request)
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(expect.objectContaining({ reason: 'HARNESS_EXIT: code=42; signal=null' })))
  })
  it('escalates termination for a process that ignores SIGTERM', async () => {
    const { adapter, request, exit, resource } = await fixture('ignore-term')
    const handle = resource.handle = await adapter.start(request)
    await handle.stop('stop')
    expect(exit).not.toHaveBeenCalled()
    expect(() => process.kill(handle.pid!, 0)).toThrow()
  })
  it('rejects secret fields, source launchers and relative paths', () => {
    const config = { cliEntry: entry, workingDirectory: '/tmp', homeDirectory: '/tmp/home', provider: 'test', model: 'test' }
    expect(() => parseHarnessConfig(null as unknown as Record<string, unknown>)).toThrow('HARNESS_CONFIG_INVALID')
    expect(() => parseHarnessConfig({ ...config, apiKey: 'secret' })).toThrow('HARNESS_CONFIG_INVALID')
    expect(() => parseHarnessConfig({ ...config, cliEntry: '/tmp/bin.ts' })).toThrow('HARNESS_CONFIG_INVALID')
    expect(() => parseHarnessConfig({ ...config, workingDirectory: '.' })).toThrow('HARNESS_CONFIG_INVALID')
  })
})

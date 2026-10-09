import { describe, expect, it } from 'vitest'
import {
  RuntimeNodeSupervisor,
  type RuntimeAdapter,
  type RuntimeAdapterStartRequest,
  type RuntimeGeneration,
  type RuntimeNodeStateSnapshot,
  type RuntimeNodeStateStore,
  type RuntimeProcessHandle,
  type RuntimeProfileId,
} from '../src/index.ts'

const profileId = 'profile-demo' as RuntimeProfileId

class MemoryStore implements RuntimeNodeStateStore {
  saves = 0

  constructor(private state: RuntimeNodeStateSnapshot = { schemaVersion: 1, profiles: [] }) {}

  async load(): Promise<RuntimeNodeStateSnapshot> {
    return structuredClone(this.state)
  }

  async save(snapshot: RuntimeNodeStateSnapshot): Promise<void> {
    this.saves += 1
    this.state = structuredClone(snapshot)
  }
}

class StubAdapter implements RuntimeAdapter {
  readonly kind = 'stub'
  starts: RuntimeAdapterStartRequest[] = []
  stops: string[] = []

  async start(request: RuntimeAdapterStartRequest): Promise<RuntimeProcessHandle> {
    this.starts.push(request)
    return { stop: async reason => { this.stops.push(reason) } }
  }
}

function clock(): () => string {
  let second = 0
  return () => `2026-10-09T08:00:${String(second++).padStart(2, '0')}.000Z`
}

async function fixture(threshold = 3) {
  const store = new MemoryStore()
  const adapter = new StubAdapter()
  const supervisor = await RuntimeNodeSupervisor.open({ store, adapters: [adapter], now: clock() })
  await supervisor.registerProfile({
    id: profileId,
    displayName: 'Demo Runtime',
    adapterKind: 'stub',
    crashThreshold: threshold,
    config: {},
    createdAt: '2026-10-09T08:00:00.000Z',
  })
  return { store, adapter, supervisor }
}

describe('RuntimeNodeSupervisor', () => {
  it('starts and stops a profile while persisting accepted transitions', async () => {
    const { store, adapter, supervisor } = await fixture()
    const started = await supervisor.start(profileId)
    expect(started).toMatchObject({ status: 'healthy', generation: 1 })
    expect(adapter.starts).toHaveLength(1)

    const stopped = await supervisor.stop(profileId, 'maintenance')
    expect(stopped).toMatchObject({ status: 'stopped', consecutiveCrashes: 0 })
    expect(adapter.stops).toEqual(['maintenance'])
    expect(store.saves).toBe(4)
  })

  it('routes adapter heartbeat and exit signals through the active generation', async () => {
    const { adapter, supervisor } = await fixture()
    await supervisor.start(profileId)
    const request = adapter.starts[0]!
    request.onHeartbeat('2026-10-09T08:00:10.000Z')
    await supervisor.heartbeat(profileId, 1 as RuntimeGeneration, '2026-10-09T08:00:11.000Z')
    expect(supervisor.getProfile(profileId).lastHeartbeatAt).toBe('2026-10-09T08:00:11.000Z')

    request.onExit({ at: '2026-10-09T08:00:12.000Z', reason: 'crash' })
    await supervisor.unexpectedExit(profileId, 0 as RuntimeGeneration, '2026-10-09T08:00:13.000Z', 'flush queue')
    await new Promise(resolve => setImmediate(resolve))
    expect(supervisor.getProfile(profileId)).toMatchObject({ status: 'crashed', consecutiveCrashes: 1 })
  })

  it('opens the circuit after consecutive adapter crashes and supports explicit recovery', async () => {
    const { supervisor } = await fixture(2)
    await supervisor.start(profileId)
    await supervisor.unexpectedExit(profileId, 1 as RuntimeGeneration, '2026-10-09T08:00:02.000Z', 'boom 1')
    await supervisor.start(profileId)
    await supervisor.unexpectedExit(profileId, 2 as RuntimeGeneration, '2026-10-09T08:00:04.000Z', 'boom 2')
    expect(supervisor.getProfile(profileId).status).toBe('safe-mode')
    await expect(supervisor.start(profileId)).rejects.toThrow(/RUNTIME_START_NOT_ALLOWED/)
    expect(await supervisor.recoverSafeMode(profileId)).toMatchObject({ status: 'stopped', consecutiveCrashes: 0 })
  })

  it('marks an active persisted generation interrupted when the host reopens', async () => {
    const { store, supervisor } = await fixture()
    await supervisor.start(profileId)

    const reopened = await RuntimeNodeSupervisor.open({
      store,
      adapters: [new StubAdapter()],
      now: () => '2026-10-09T08:01:00.000Z',
    })
    expect(reopened.getProfile(profileId)).toMatchObject({ status: 'interrupted', generation: 1 })
  })

  it('rejects profiles for adapters that are not installed', async () => {
    const supervisor = await RuntimeNodeSupervisor.open({
      store: new MemoryStore(), adapters: [], now: clock(),
    })
    await expect(supervisor.registerProfile({
      id: profileId,
      displayName: 'Missing Adapter',
      adapterKind: 'missing',
      crashThreshold: 3,
      config: {},
      createdAt: '2026-10-09T08:00:00.000Z',
    })).rejects.toThrow(/RUNTIME_ADAPTER_NOT_FOUND/)
  })
})

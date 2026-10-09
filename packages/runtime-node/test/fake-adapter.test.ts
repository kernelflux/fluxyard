import { describe, expect, it } from 'vitest'
import {
  FakeRuntimeAdapter,
  RuntimeNodeSupervisor,
  type RuntimeGeneration,
  type RuntimeNodeStateSnapshot,
  type RuntimeNodeStateStore,
  type RuntimeProfileId,
} from '../src/index.ts'

class MemoryStore implements RuntimeNodeStateStore {
  state: RuntimeNodeStateSnapshot = { schemaVersion: 1, profiles: [] }
  async load() { return structuredClone(this.state) }
  async save(snapshot: RuntimeNodeStateSnapshot) { this.state = structuredClone(snapshot) }
}

describe('FakeRuntimeAdapter', () => {
  it('drives heartbeat and crash signals through the real supervisor', async () => {
    let tick = 0
    const now = () => `2026-10-09T08:00:${String(tick++).padStart(2, '0')}.000Z`
    const adapter = new FakeRuntimeAdapter()
    const supervisor = await RuntimeNodeSupervisor.open({ store: new MemoryStore(), adapters: [adapter], now })
    const profileId = 'profile-fake' as RuntimeProfileId
    await supervisor.registerProfile({
      id: profileId,
      displayName: 'Fake Runtime',
      adapterKind: 'fake',
      crashThreshold: 3,
      config: {},
      createdAt: now(),
    })
    await supervisor.start(profileId)
    const process = adapter.getProcess(profileId, 1 as RuntimeGeneration)
    await process.heartbeat(now())
    expect(supervisor.getProfile(profileId).status).toBe('healthy')
    await process.crash(now(), 'simulated crash')
    expect(supervisor.getProfile(profileId)).toMatchObject({ status: 'crashed', consecutiveCrashes: 1 })
    await expect(process.heartbeat(now())).rejects.toThrow(/FAKE_RUNTIME_NOT_RUNNING/)
  })
})

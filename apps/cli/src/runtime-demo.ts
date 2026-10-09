import {
  FakeRuntimeAdapter,
  JsonRuntimeNodeStateStore,
  RuntimeNodeSupervisor,
  type RuntimeGeneration,
  type RuntimeProfileId,
} from '@fluxyard/runtime-node'

export async function runRuntimeDemo(path: string): Promise<object> {
  let tick = 0
  const now = () => `2026-10-09T08:00:${String(tick++).padStart(2, '0')}.000Z`
  const store = new JsonRuntimeNodeStateStore(path)
  const adapter = new FakeRuntimeAdapter()
  const supervisor = await RuntimeNodeSupervisor.open({ store, adapters: [adapter], now })
  const profileId = 'profile-demo' as RuntimeProfileId

  const existing = supervisor.listProfiles().find(profile => profile.definition.id === profileId)
  if (!existing) {
    await supervisor.registerProfile({
      id: profileId,
      displayName: 'Demo Runtime',
      adapterKind: 'fake',
      crashThreshold: 3,
      config: { purpose: 'runtime lifecycle demonstration' },
      createdAt: now(),
    })

    for (let generation = 1; generation <= 3; generation += 1) {
      await supervisor.start(profileId)
      const process = adapter.getProcess(profileId, generation as RuntimeGeneration)
      await process.heartbeat(now())
      await process.crash(now(), `simulated crash ${generation}`)
    }
  }

  const beforeRestart = supervisor.getProfile(profileId)
  const reopened = await RuntimeNodeSupervisor.open({
    store,
    adapters: [new FakeRuntimeAdapter()],
    now,
  })
  return {
    statePath: path,
    beforeRestart,
    afterRestart: reopened.getProfile(profileId),
    circuitOpen: reopened.getProfile(profileId).status === 'safe-mode',
  }
}

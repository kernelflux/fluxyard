import { createRuntimeProfileState, reduceRuntimeProfile, validateRuntimeProfileState } from './lifecycle.ts'
import {
  RuntimeNodeInvariantError,
  type RuntimeAdapter,
  type RuntimeGeneration,
  type RuntimeNodeStateSnapshot,
  type RuntimeNodeStateStore,
  type RuntimeProcessHandle,
  type RuntimeProfileDefinition,
  type RuntimeProfileId,
  type RuntimeProfileState,
} from './model.ts'

export interface RuntimeNodeSupervisorOptions {
  readonly store: RuntimeNodeStateStore
  readonly adapters: readonly RuntimeAdapter[]
  readonly now?: () => string
}

export class RuntimeNodeSupervisor {
  private readonly profiles = new Map<RuntimeProfileId, RuntimeProfileState>()
  private readonly adapters = new Map<string, RuntimeAdapter>()
  private readonly processes = new Map<RuntimeProfileId, RuntimeProcessHandle>()
  private readonly operations = new Map<RuntimeProfileId, Promise<unknown>>()
  private readonly store: RuntimeNodeStateStore
  private readonly now: () => string

  private constructor(
    store: RuntimeNodeStateStore,
    adapters: readonly RuntimeAdapter[],
    now: () => string,
  ) {
    this.store = store
    this.now = now
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.kind)) fail('RUNTIME_ADAPTER_DUPLICATE', `duplicate adapter ${adapter.kind}`)
      this.adapters.set(adapter.kind, adapter)
    }
  }

  static async open(options: RuntimeNodeSupervisorOptions): Promise<RuntimeNodeSupervisor> {
    const supervisor = new RuntimeNodeSupervisor(
      options.store,
      options.adapters,
      options.now ?? (() => new Date().toISOString()),
    )
    const snapshot = await options.store.load()
    if (snapshot.schemaVersion !== 1) fail('RUNTIME_STATE_VERSION_UNSUPPORTED', 'only schema version 1 is supported')

    let recovered = false
    for (const loaded of snapshot.profiles) {
      validateRuntimeProfileState(loaded)
      if (supervisor.profiles.has(loaded.definition.id)) {
        fail('RUNTIME_PROFILE_DUPLICATE', `duplicate profile ${loaded.definition.id} in state store`)
      }
      const state = reduceRuntimeProfile(loaded, { type: 'host-restarted', at: supervisor.now() })
      recovered ||= state !== loaded
      supervisor.profiles.set(state.definition.id, state)
    }
    if (recovered) await supervisor.persist()
    return supervisor
  }

  async registerProfile(definition: RuntimeProfileDefinition): Promise<'created' | 'existing'> {
    if (!this.adapters.has(definition.adapterKind)) {
      fail('RUNTIME_ADAPTER_NOT_FOUND', `adapter ${definition.adapterKind} is not installed`)
    }
    const existing = this.profiles.get(definition.id)
    if (existing) {
      if (canonical(existing.definition) !== canonical(definition)) {
        fail('RUNTIME_PROFILE_ID_CONFLICT', `profile ${definition.id} already has different configuration`)
      }
      return 'existing'
    }
    this.profiles.set(definition.id, createRuntimeProfileState(definition))
    try {
      await this.persist()
    } catch (error) {
      this.profiles.delete(definition.id)
      throw error
    }
    return 'created'
  }

  listProfiles(): readonly RuntimeProfileState[] {
    return structuredClone([...this.profiles.values()])
  }

  getProfile(id: RuntimeProfileId): RuntimeProfileState {
    const state = this.profiles.get(id)
    if (!state) fail('RUNTIME_PROFILE_NOT_FOUND', `profile ${id} is not registered`)
    return structuredClone(state)
  }

  async start(id: RuntimeProfileId): Promise<RuntimeProfileState> {
    return this.serialize(id, async () => {
      let state = this.requireProfile(id)
      const adapter = this.adapters.get(state.definition.adapterKind)
      if (!adapter) fail('RUNTIME_ADAPTER_NOT_FOUND', `adapter ${state.definition.adapterKind} is not installed`)

      state = await this.transition(id, { type: 'start-requested', at: this.now() })
      const generation = state.generation
      try {
        const handle = await adapter.start({
          profile: structuredClone(state.definition),
          generation,
          onHeartbeat: at => { void this.heartbeat(id, generation, at) },
          onExit: exit => { void this.unexpectedExit(id, generation, exit.at, exit.reason) },
        })
        this.processes.set(id, handle)
        return this.transition(id, { type: 'process-started', generation, at: this.now() })
      } catch (error) {
        return this.transition(id, {
          type: 'process-exited',
          generation,
          at: this.now(),
          expected: false,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    })
  }

  async stop(id: RuntimeProfileId, reason = 'operator stop'): Promise<RuntimeProfileState> {
    return this.serialize(id, async () => {
      const state = this.requireProfile(id)
      const handle = this.processes.get(id)
      if (!handle) fail('RUNTIME_PROCESS_NOT_FOUND', `profile ${id} has no active process`)
      await handle.stop(reason)
      this.processes.delete(id)
      return this.transition(id, {
        type: 'process-exited',
        generation: state.generation,
        at: this.now(),
        expected: true,
        reason,
      })
    })
  }

  async heartbeat(id: RuntimeProfileId, generation: RuntimeGeneration, at = this.now()): Promise<RuntimeProfileState> {
    return this.serialize(id, () => this.transition(id, { type: 'heartbeat', generation, at }))
  }

  async markUnhealthy(id: RuntimeProfileId, generation: RuntimeGeneration): Promise<RuntimeProfileState> {
    return this.serialize(id, () => this.transition(id, {
      type: 'health-timeout', generation, at: this.now(),
    }))
  }

  async unexpectedExit(
    id: RuntimeProfileId,
    generation: RuntimeGeneration,
    at: string,
    reason: string,
  ): Promise<RuntimeProfileState> {
    return this.serialize(id, async () => {
      const before = this.requireProfile(id)
      const state = await this.transition(id, {
        type: 'process-exited', generation, at, expected: false, reason,
      })
      if (generation === before.generation) this.processes.delete(id)
      return state
    })
  }

  async recoverSafeMode(id: RuntimeProfileId): Promise<RuntimeProfileState> {
    return this.serialize(id, () => this.transition(id, { type: 'recover-safe-mode', at: this.now() }))
  }

  snapshot(): RuntimeNodeStateSnapshot {
    return { schemaVersion: 1, profiles: this.listProfiles() }
  }

  private requireProfile(id: RuntimeProfileId): RuntimeProfileState {
    const state = this.profiles.get(id)
    if (!state) fail('RUNTIME_PROFILE_NOT_FOUND', `profile ${id} is not registered`)
    return state
  }

  private async transition(
    id: RuntimeProfileId,
    event: Parameters<typeof reduceRuntimeProfile>[1],
  ): Promise<RuntimeProfileState> {
    const previous = this.requireProfile(id)
    const next = reduceRuntimeProfile(previous, event)
    if (next === previous) return structuredClone(previous)
    this.profiles.set(id, next)
    try {
      await this.persist()
    } catch (error) {
      this.profiles.set(id, previous)
      throw error
    }
    return structuredClone(next)
  }

  private async persist(): Promise<void> {
    await this.store.save(this.snapshot())
  }

  private serialize<T>(id: RuntimeProfileId, operation: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(id) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    this.operations.set(id, current)
    return current.finally(() => {
      if (this.operations.get(id) === current) this.operations.delete(id)
    })
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function fail(code: string, message: string): never {
  throw new RuntimeNodeInvariantError(code, message)
}

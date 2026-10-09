import { RuntimeNodeInvariantError } from './model.ts'
import type {
  RuntimeAdapter,
  RuntimeAdapterStartRequest,
  RuntimeGeneration,
  RuntimeProcessHandle,
  RuntimeProfileId,
} from './model.ts'

export class FakeRuntimeProcess implements RuntimeProcessHandle {
  readonly profileId: RuntimeProfileId
  readonly generation: RuntimeGeneration
  private stopped = false
  private readonly request: RuntimeAdapterStartRequest

  constructor(request: RuntimeAdapterStartRequest) {
    this.request = request
    this.profileId = request.profile.id
    this.generation = request.generation
  }

  async heartbeat(at: string): Promise<void> {
    this.requireRunning()
    await this.request.onHeartbeat(at)
  }

  async crash(at: string, reason: string): Promise<void> {
    this.requireRunning()
    this.stopped = true
    await this.request.onExit({ at, reason })
  }

  async stop(_reason: string): Promise<void> {
    this.requireRunning()
    this.stopped = true
  }

  private requireRunning(): void {
    if (this.stopped) {
      throw new RuntimeNodeInvariantError(
        'FAKE_RUNTIME_NOT_RUNNING',
        `${this.profileId} generation ${this.generation} is already stopped`,
      )
    }
  }
}

export class FakeRuntimeAdapter implements RuntimeAdapter {
  readonly kind: string
  private readonly processes = new Map<string, FakeRuntimeProcess>()

  constructor(kind = 'fake') {
    this.kind = kind
  }

  async start(request: RuntimeAdapterStartRequest): Promise<FakeRuntimeProcess> {
    const process = new FakeRuntimeProcess(request)
    this.processes.set(key(request.profile.id, request.generation), process)
    return process
  }

  getProcess(profileId: RuntimeProfileId, generation: RuntimeGeneration): FakeRuntimeProcess {
    const process = this.processes.get(key(profileId, generation))
    if (!process) {
      throw new RuntimeNodeInvariantError(
        'FAKE_RUNTIME_NOT_FOUND',
        `${profileId} generation ${generation} was not started`,
      )
    }
    return process
  }
}

function key(profileId: RuntimeProfileId, generation: RuntimeGeneration): string {
  return `${profileId}:${generation}`
}

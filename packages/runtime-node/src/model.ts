export type RuntimeProfileId = string & { readonly __brand: 'RuntimeProfileId' }
export type RuntimeGeneration = number & { readonly __brand: 'RuntimeGeneration' }

export type RuntimeProfileStatus =
  | 'stopped'
  | 'starting'
  | 'healthy'
  | 'unhealthy'
  | 'crashed'
  | 'safe-mode'
  | 'interrupted'

export interface RuntimeProfileDefinition {
  readonly id: RuntimeProfileId
  readonly displayName: string
  readonly adapterKind: string
  readonly crashThreshold: number
  readonly config: Readonly<Record<string, unknown>>
  readonly createdAt: string
}

export interface RuntimeExitRecord {
  readonly generation: RuntimeGeneration
  readonly at: string
  readonly expected: boolean
  readonly reason: string
}

export interface RuntimeProfileState {
  readonly definition: RuntimeProfileDefinition
  readonly status: RuntimeProfileStatus
  readonly generation: RuntimeGeneration
  readonly consecutiveCrashes: number
  readonly lastHeartbeatAt?: string
  readonly lastExit?: RuntimeExitRecord
  readonly safeModeReason?: string
  readonly updatedAt: string
}

export type RuntimeLifecycleEvent =
  | { readonly type: 'start-requested'; readonly at: string }
  | { readonly type: 'process-started'; readonly generation: RuntimeGeneration; readonly at: string }
  | { readonly type: 'heartbeat'; readonly generation: RuntimeGeneration; readonly at: string }
  | { readonly type: 'health-timeout'; readonly generation: RuntimeGeneration; readonly at: string }
  | {
      readonly type: 'process-exited'
      readonly generation: RuntimeGeneration
      readonly at: string
      readonly expected: boolean
      readonly reason: string
    }
  | { readonly type: 'recover-safe-mode'; readonly at: string }
  | { readonly type: 'host-restarted'; readonly at: string }

export class RuntimeNodeInvariantError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(`${code}: ${message}`)
    this.code = code
    this.name = 'RuntimeNodeInvariantError'
  }
}

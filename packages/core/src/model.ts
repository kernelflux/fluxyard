export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' }
export type RuntimeNodeId = string & { readonly __brand: 'RuntimeNodeId' }
export type AgentId = string & { readonly __brand: 'AgentId' }
export type RunId = string & { readonly __brand: 'RunId' }
export type UsageEventId = string & { readonly __brand: 'UsageEventId' }

export interface Workspace {
  readonly id: WorkspaceId
  readonly name: string
  readonly createdAt: string
}

export interface RuntimeAdapterDescriptor {
  readonly kind: string
  readonly version: string
  readonly capabilities: readonly string[]
}

export interface RuntimeNode {
  readonly id: RuntimeNodeId
  readonly workspaceId: WorkspaceId
  readonly displayName: string
  readonly platform: 'macos' | 'windows' | 'linux' | 'ios' | 'android'
  readonly adapters: readonly RuntimeAdapterDescriptor[]
  readonly createdAt: string
}

export interface AgentIdentity {
  readonly id: AgentId
  readonly workspaceId: WorkspaceId
  readonly runtimeNodeId: RuntimeNodeId
  readonly name: string
  readonly ownerId: string
  readonly runtimeKind: string
  readonly version: string
  readonly createdAt: string
}

interface UsageEventBase {
  readonly id: UsageEventId
  readonly workspaceId: WorkspaceId
  readonly runtimeNodeId: RuntimeNodeId
  readonly agentId: AgentId
  readonly runId: RunId
  readonly sequence: number
  readonly occurredAt: string
}

export interface ModelUsageEvent extends UsageEventBase {
  readonly kind: 'model'
  readonly provider: string
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly costMicros: number
}

export interface ToolUsageEvent extends UsageEventBase {
  readonly kind: 'tool'
  readonly tool: string
  readonly calls: number
  readonly durationMs: number
}

export interface RuntimeUsageEvent extends UsageEventBase {
  readonly kind: 'runtime'
  readonly durationMs: number
}

export type UsageEvent = ModelUsageEvent | ToolUsageEvent | RuntimeUsageEvent

export interface UsageFilter {
  readonly workspaceId: WorkspaceId
  readonly agentId?: AgentId
  readonly runId?: RunId
}

export interface UsageSummary {
  readonly eventCount: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly toolCalls: number
  readonly toolDurationMs: number
  readonly runtimeDurationMs: number
  readonly costMicros: number
}

export interface ControlPlaneSnapshot {
  readonly schemaVersion: 1
  readonly workspaces: readonly Workspace[]
  readonly runtimeNodes: readonly RuntimeNode[]
  readonly agents: readonly AgentIdentity[]
  readonly usageEvents: readonly UsageEvent[]
}

export class ControlPlaneInvariantError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(`${code}: ${message}`)
    this.code = code
    this.name = 'ControlPlaneInvariantError'
  }
}

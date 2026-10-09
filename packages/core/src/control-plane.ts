import {
  ControlPlaneInvariantError,
  type AgentIdentity,
  type ControlPlaneSnapshot,
  type RuntimeNode,
  type UsageEvent,
  type UsageFilter,
  type UsageSummary,
  type Workspace,
  type WorkspaceId,
} from './model.ts'

const EMPTY_SNAPSHOT: ControlPlaneSnapshot = {
  schemaVersion: 1,
  workspaces: [],
  runtimeNodes: [],
  agents: [],
  usageEvents: [],
}

const EMPTY_USAGE_SUMMARY: UsageSummary = {
  eventCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  toolCalls: 0,
  toolDurationMs: 0,
  runtimeDurationMs: 0,
  costMicros: 0,
}

export class AgentControlPlane {
  private readonly workspaces = new Map<string, Workspace>()
  private readonly runtimeNodes = new Map<string, RuntimeNode>()
  private readonly agents = new Map<string, AgentIdentity>()
  private readonly usageEvents = new Map<string, UsageEvent>()

  constructor(snapshot: ControlPlaneSnapshot = EMPTY_SNAPSHOT) {
    if (snapshot.schemaVersion !== 1) fail('SCHEMA_VERSION_UNSUPPORTED', 'only schema version 1 is supported')
    for (const workspace of snapshot.workspaces) this.registerWorkspace(workspace)
    for (const node of snapshot.runtimeNodes) this.registerRuntimeNode(node)
    for (const agent of snapshot.agents) this.registerAgent(agent)
    for (const event of [...snapshot.usageEvents].sort(compareUsageEvents)) this.recordUsage(event)
  }

  registerWorkspace(workspace: Workspace): 'created' | 'existing' {
    validateIdentifier(workspace.id, 'workspace id')
    validateText(workspace.name, 'workspace name')
    validateTimestamp(workspace.createdAt, 'workspace createdAt')
    return putOnce(this.workspaces, workspace.id, workspace, 'WORKSPACE_ID_CONFLICT')
  }

  registerRuntimeNode(node: RuntimeNode): 'created' | 'existing' {
    this.requireWorkspace(node.workspaceId)
    validateIdentifier(node.id, 'runtime node id')
    validateText(node.displayName, 'runtime node displayName')
    validateTimestamp(node.createdAt, 'runtime node createdAt')
    if (node.adapters.length === 0) fail('RUNTIME_ADAPTER_REQUIRED', 'runtime node must expose an adapter')
    for (const adapter of node.adapters) {
      validateText(adapter.kind, 'runtime adapter kind')
      validateText(adapter.version, 'runtime adapter version')
    }
    return putOnce(this.runtimeNodes, node.id, node, 'RUNTIME_NODE_ID_CONFLICT')
  }

  registerAgent(agent: AgentIdentity): 'created' | 'existing' {
    this.requireWorkspace(agent.workspaceId)
    validateIdentifier(agent.id, 'agent id')
    const node = this.runtimeNodes.get(agent.runtimeNodeId)
    if (!node) fail('RUNTIME_NODE_NOT_FOUND', `runtime node ${agent.runtimeNodeId} is not registered`)
    if (node.workspaceId !== agent.workspaceId) {
      fail('WORKSPACE_BOUNDARY_VIOLATION', 'agent and runtime node belong to different workspaces')
    }
    if (!node.adapters.some(adapter => adapter.kind === agent.runtimeKind)) {
      fail('RUNTIME_ADAPTER_NOT_AVAILABLE', `runtime node does not expose ${agent.runtimeKind}`)
    }
    validateText(agent.name, 'agent name')
    validateText(agent.ownerId, 'agent ownerId')
    validateText(agent.version, 'agent version')
    validateTimestamp(agent.createdAt, 'agent createdAt')
    return putOnce(this.agents, agent.id, agent, 'AGENT_ID_CONFLICT')
  }

  recordUsage(event: UsageEvent): 'appended' | 'duplicate' {
    const existing = this.usageEvents.get(event.id)
    if (existing) {
      if (canonical(existing) === canonical(event)) return 'duplicate'
      fail('USAGE_EVENT_ID_CONFLICT', `usage event ${event.id} was replayed with different data`)
    }

    this.requireWorkspace(event.workspaceId)
    validateIdentifier(event.id, 'usage event id')
    validateIdentifier(event.runId, 'run id')
    const node = this.runtimeNodes.get(event.runtimeNodeId)
    const agent = this.agents.get(event.agentId)
    if (!node) fail('RUNTIME_NODE_NOT_FOUND', `runtime node ${event.runtimeNodeId} is not registered`)
    if (!agent) fail('AGENT_NOT_FOUND', `agent ${event.agentId} is not registered`)
    if (node.workspaceId !== event.workspaceId || agent.workspaceId !== event.workspaceId) {
      fail('WORKSPACE_BOUNDARY_VIOLATION', 'usage references resources outside its workspace')
    }
    if (agent.runtimeNodeId !== event.runtimeNodeId) {
      fail('AGENT_NODE_MISMATCH', 'usage runtime node does not host the agent')
    }

    validateTimestamp(event.occurredAt, 'usage occurredAt')
    validateNonNegativeInteger(event.sequence, 'sequence')
    validateUsageMeasures(event)

    const lastSequence = [...this.usageEvents.values()]
      .filter(candidate => candidate.workspaceId === event.workspaceId && candidate.runId === event.runId)
      .reduce((maximum, candidate) => Math.max(maximum, candidate.sequence), -1)
    if (event.sequence <= lastSequence) {
      fail('USAGE_SEQUENCE_OUT_OF_ORDER', `sequence ${event.sequence} must be greater than ${lastSequence}`)
    }

    this.usageEvents.set(event.id, event)
    return 'appended'
  }

  listWorkspaces(): readonly Workspace[] {
    return [...this.workspaces.values()]
  }

  listRuntimeNodes(workspaceId: WorkspaceId): readonly RuntimeNode[] {
    this.requireWorkspace(workspaceId)
    return [...this.runtimeNodes.values()].filter(node => node.workspaceId === workspaceId)
  }

  listAgents(workspaceId: WorkspaceId): readonly AgentIdentity[] {
    this.requireWorkspace(workspaceId)
    return [...this.agents.values()].filter(agent => agent.workspaceId === workspaceId)
  }

  summarizeUsage(filter: UsageFilter): UsageSummary {
    this.requireWorkspace(filter.workspaceId)
    const events = [...this.usageEvents.values()].filter(event =>
      event.workspaceId === filter.workspaceId
      && (!filter.agentId || event.agentId === filter.agentId)
      && (!filter.runId || event.runId === filter.runId),
    )

    return events.reduce<UsageSummary>((summary, event) => {
      if (event.kind === 'model') {
        return addSafe(summary, {
          eventCount: 1,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cacheReadTokens: event.cacheReadTokens ?? 0,
          cacheWriteTokens: event.cacheWriteTokens ?? 0,
          costMicros: event.costMicros,
        })
      }
      if (event.kind === 'tool') {
        return addSafe(summary, { eventCount: 1, toolCalls: event.calls, toolDurationMs: event.durationMs })
      }
      return addSafe(summary, { eventCount: 1, runtimeDurationMs: event.durationMs })
    }, EMPTY_USAGE_SUMMARY)
  }

  snapshot(): ControlPlaneSnapshot {
    return structuredClone({
      schemaVersion: 1,
      workspaces: [...this.workspaces.values()],
      runtimeNodes: [...this.runtimeNodes.values()],
      agents: [...this.agents.values()],
      usageEvents: [...this.usageEvents.values()],
    })
  }

  private requireWorkspace(id: WorkspaceId): Workspace {
    const workspace = this.workspaces.get(id)
    if (!workspace) fail('WORKSPACE_NOT_FOUND', `workspace ${id} is not registered`)
    return workspace
  }
}

function compareUsageEvents(left: UsageEvent, right: UsageEvent): number {
  if (left.workspaceId !== right.workspaceId) return left.workspaceId.localeCompare(right.workspaceId)
  if (left.runId !== right.runId) return left.runId.localeCompare(right.runId)
  return left.sequence - right.sequence
}

function putOnce<T>(map: Map<string, T>, id: string, value: T, code: string): 'created' | 'existing' {
  const existing = map.get(id)
  if (!existing) {
    map.set(id, structuredClone(value))
    return 'created'
  }
  if (canonical(existing) !== canonical(value)) fail(code, `${id} is already registered with different data`)
  return 'existing'
}

function validateUsageMeasures(event: UsageEvent): void {
  if (event.kind === 'model') {
    validateNonNegativeInteger(event.inputTokens, 'inputTokens')
    validateNonNegativeInteger(event.outputTokens, 'outputTokens')
    validateNonNegativeInteger(event.cacheReadTokens ?? 0, 'cacheReadTokens')
    validateNonNegativeInteger(event.cacheWriteTokens ?? 0, 'cacheWriteTokens')
    validateNonNegativeInteger(event.costMicros, 'costMicros')
    validateText(event.provider, 'provider')
    validateText(event.model, 'model')
  } else if (event.kind === 'tool') {
    validateText(event.tool, 'tool')
    validateNonNegativeInteger(event.calls, 'calls')
    validateNonNegativeInteger(event.durationMs, 'durationMs')
  } else {
    validateNonNegativeInteger(event.durationMs, 'durationMs')
  }
}

function addSafe(summary: UsageSummary, increments: Partial<UsageSummary>): UsageSummary {
  const result = { ...summary }
  for (const key of Object.keys(increments) as (keyof UsageSummary)[]) {
    const value = summary[key] + (increments[key] ?? 0)
    if (!Number.isSafeInteger(value)) fail('USAGE_TOTAL_OVERFLOW', `${key} exceeds the safe integer range`)
    result[key] = value
  }
  return result
}

function validateIdentifier(value: string, field: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) {
    fail('INVALID_IDENTIFIER', `${field} must be 1-128 portable identifier characters`)
  }
}

function validateNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('INVALID_USAGE_MEASURE', `${field} must be a non-negative safe integer`)
  }
}

function validateText(value: string, field: string): void {
  if (value.trim().length === 0) fail('INVALID_TEXT', `${field} must be non-empty`)
}

function validateTimestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) fail('INVALID_TIMESTAMP', `${field} must be ISO-compatible`)
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
  throw new ControlPlaneInvariantError(code, message)
}

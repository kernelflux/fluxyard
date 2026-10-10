import { describe, expect, it } from 'vitest'
import {
  AgentControlPlane,
  type AgentId,
  type RunId,
  type RuntimeNodeId,
  type UsageEventId,
  type WorkspaceId,
} from '../src/index.ts'

const workspaceId = 'workspace-acme' as WorkspaceId
const otherWorkspaceId = 'workspace-other' as WorkspaceId
const nodeId = 'node-mac-01' as RuntimeNodeId
const agentId = 'agent-release' as AgentId
const runId = 'run-001' as RunId
const at = '2026-10-09T08:00:00.000Z'

function fixture(): AgentControlPlane {
  const plane = new AgentControlPlane()
  plane.registerWorkspace({ id: workspaceId, name: 'Acme', createdAt: at })
  plane.registerRuntimeNode({
    id: nodeId,
    workspaceId,
    displayName: 'Build Mac',
    platform: 'macos',
    adapters: [{ kind: 'deepseek-harness', version: '0.2.0', capabilities: ['session', 'delivery'] }],
    createdAt: at,
  })
  plane.registerAgent({
    id: agentId,
    workspaceId,
    runtimeNodeId: nodeId,
    name: 'Release Agent',
    ownerId: 'team-platform',
    runtimeKind: 'deepseek-harness',
    version: '1.0.0',
    createdAt: at,
  })
  return plane
}

describe('AgentControlPlane', () => {
  it('registers inventory and aggregates model, tool and runtime usage', () => {
    const plane = fixture()
    plane.recordUsage({
      id: 'event-model' as UsageEventId, workspaceId, runtimeNodeId: nodeId, agentId, runId,
      sequence: 0, occurredAt: at, kind: 'model', provider: 'deepseek-official',
      model: 'deepseek-chat', inputTokens: 1_000, outputTokens: 250, cacheReadTokens: 300,
      costMicros: 12_345,
    })
    plane.recordUsage({
      id: 'event-tool' as UsageEventId, workspaceId, runtimeNodeId: nodeId, agentId, runId,
      sequence: 1, occurredAt: at, kind: 'tool', tool: 'delivery.build', calls: 1, durationMs: 420,
    })
    plane.recordUsage({
      id: 'event-runtime' as UsageEventId, workspaceId, runtimeNodeId: nodeId, agentId, runId,
      sequence: 2, occurredAt: at, kind: 'runtime', durationMs: 800,
    })

    expect(plane.summarizeUsage({ workspaceId, agentId, runId })).toEqual({
      eventCount: 3,
      inputTokens: 1_000,
      outputTokens: 250,
      cacheReadTokens: 300,
      cacheWriteTokens: 0,
      toolCalls: 1,
      toolDurationMs: 420,
      runtimeDurationMs: 800,
      costMicros: 12_345,
    })
  })

  it('makes identical retries idempotent and rejects conflicting replay', () => {
    const plane = fixture()
    const event = {
      id: 'event-1' as UsageEventId, workspaceId, runtimeNodeId: nodeId, agentId, runId,
      sequence: 0, occurredAt: at, kind: 'runtime' as const, durationMs: 100,
    }

    expect(plane.recordUsage(event)).toBe('appended')
    expect(plane.recordUsage(event)).toBe('duplicate')
    expect(() => plane.recordUsage({ ...event, durationMs: 101 })).toThrow(/USAGE_EVENT_ID_CONFLICT/)
    expect(plane.summarizeUsage({ workspaceId }).eventCount).toBe(1)
  })

  it('rejects out-of-order run facts', () => {
    const plane = fixture()
    plane.recordUsage({
      id: 'event-2' as UsageEventId, workspaceId, runtimeNodeId: nodeId, agentId, runId,
      sequence: 2, occurredAt: at, kind: 'runtime', durationMs: 100,
    })
    expect(() => plane.recordUsage({
      id: 'event-1' as UsageEventId, workspaceId, runtimeNodeId: nodeId, agentId, runId,
      sequence: 1, occurredAt: at, kind: 'runtime', durationMs: 100,
    })).toThrow(/USAGE_SEQUENCE_OUT_OF_ORDER/)
  })

  it('rejects cross-workspace inventory references', () => {
    const plane = fixture()
    plane.registerWorkspace({ id: otherWorkspaceId, name: 'Other', createdAt: at })
    expect(() => plane.registerAgent({
      id: 'agent-cross-tenant' as AgentId,
      workspaceId: otherWorkspaceId,
      runtimeNodeId: nodeId,
      name: 'Cross tenant',
      ownerId: 'intruder',
      runtimeKind: 'deepseek-harness',
      version: '1.0.0',
      createdAt: at,
    })).toThrow(/WORKSPACE_BOUNDARY_VIOLATION/)
  })

  it('requires the node to advertise the agent runtime adapter', () => {
    const plane = new AgentControlPlane()
    plane.registerWorkspace({ id: workspaceId, name: 'Acme', createdAt: at })
    plane.registerRuntimeNode({
      id: nodeId,
      workspaceId,
      displayName: 'Build Mac',
      platform: 'macos',
      adapters: [{ kind: 'other-runtime', version: '1.0.0', capabilities: [] }],
      createdAt: at,
    })
    expect(() => plane.registerAgent({
      id: agentId,
      workspaceId,
      runtimeNodeId: nodeId,
      name: 'Release Agent',
      ownerId: 'team-platform',
      runtimeKind: 'deepseek-harness',
      version: '1.0.0',
      createdAt: at,
    })).toThrow(/RUNTIME_ADAPTER_NOT_AVAILABLE/)
  })

  it('round-trips a snapshot through invariant validation', () => {
    const plane = fixture()
    const restored = new AgentControlPlane(plane.snapshot())
    expect(restored.snapshot()).toEqual(plane.snapshot())
  })
})

import { describe, expect, it } from 'vitest'
import {
  createRuntimeProfileState,
  reduceRuntimeProfile,
  type RuntimeGeneration,
  type RuntimeProfileDefinition,
  type RuntimeProfileId,
} from '../src/index.ts'

const at = (second: number) => `2026-10-09T08:00:${String(second).padStart(2, '0')}.000Z`

function definition(crashThreshold = 3): RuntimeProfileDefinition {
  return {
    id: 'profile-demo' as RuntimeProfileId,
    displayName: 'Demo Runtime',
    adapterKind: 'fake',
    crashThreshold,
    config: {},
    createdAt: at(0),
  }
}

describe('runtime profile lifecycle', () => {
  it('starts a new generation and becomes healthy on process start and heartbeat', () => {
    let state = createRuntimeProfileState(definition())
    state = reduceRuntimeProfile(state, { type: 'start-requested', at: at(1) })
    expect(state).toMatchObject({ status: 'starting', generation: 1 })
    state = reduceRuntimeProfile(state, {
      type: 'process-started', generation: 1 as RuntimeGeneration, at: at(2),
    })
    state = reduceRuntimeProfile(state, {
      type: 'heartbeat', generation: 1 as RuntimeGeneration, at: at(3),
    })
    expect(state).toMatchObject({ status: 'healthy', lastHeartbeatAt: at(3) })
  })

  it('marks a healthy generation unhealthy after a heartbeat timeout', () => {
    let state = createRuntimeProfileState(definition())
    state = reduceRuntimeProfile(state, { type: 'start-requested', at: at(1) })
    state = reduceRuntimeProfile(state, {
      type: 'process-started', generation: 1 as RuntimeGeneration, at: at(2),
    })
    state = reduceRuntimeProfile(state, {
      type: 'health-timeout', generation: 1 as RuntimeGeneration, at: at(9),
    })
    expect(state.status).toBe('unhealthy')
  })

  it('ignores a late exit from an older process generation', () => {
    let state = createRuntimeProfileState(definition())
    state = reduceRuntimeProfile(state, { type: 'start-requested', at: at(1) })
    state = reduceRuntimeProfile(state, {
      type: 'process-exited', generation: 1 as RuntimeGeneration, at: at(2), expected: false, reason: 'boom',
    })
    state = reduceRuntimeProfile(state, { type: 'start-requested', at: at(3) })
    const afterLateExit = reduceRuntimeProfile(state, {
      type: 'process-exited', generation: 1 as RuntimeGeneration, at: at(4), expected: false, reason: 'late',
    })
    expect(afterLateExit).toBe(state)
    expect(afterLateExit).toMatchObject({ status: 'starting', generation: 2, consecutiveCrashes: 1 })
  })

  it('enters Safe Mode at the crash threshold and requires explicit recovery', () => {
    let state = createRuntimeProfileState(definition(2))
    state = reduceRuntimeProfile(state, { type: 'start-requested', at: at(1) })
    state = reduceRuntimeProfile(state, {
      type: 'process-exited', generation: 1 as RuntimeGeneration, at: at(2), expected: false, reason: 'boom 1',
    })
    state = reduceRuntimeProfile(state, { type: 'start-requested', at: at(3) })
    state = reduceRuntimeProfile(state, {
      type: 'process-exited', generation: 2 as RuntimeGeneration, at: at(4), expected: false, reason: 'boom 2',
    })
    expect(state).toMatchObject({ status: 'safe-mode', consecutiveCrashes: 2 })
    expect(() => reduceRuntimeProfile(state, { type: 'start-requested', at: at(5) }))
      .toThrow(/RUNTIME_START_NOT_ALLOWED/)
    state = reduceRuntimeProfile(state, { type: 'recover-safe-mode', at: at(5) })
    expect(state).toMatchObject({ status: 'stopped', consecutiveCrashes: 0 })
  })

  it('does not count a requested stop as a crash', () => {
    let state = createRuntimeProfileState(definition())
    state = reduceRuntimeProfile(state, { type: 'start-requested', at: at(1) })
    state = reduceRuntimeProfile(state, {
      type: 'process-exited', generation: 1 as RuntimeGeneration, at: at(2), expected: true, reason: 'operator stop',
    })
    expect(state).toMatchObject({ status: 'stopped', consecutiveCrashes: 0 })
  })

  it('marks active state interrupted after host restart', () => {
    let state = createRuntimeProfileState(definition())
    state = reduceRuntimeProfile(state, { type: 'start-requested', at: at(1) })
    state = reduceRuntimeProfile(state, {
      type: 'process-started', generation: 1 as RuntimeGeneration, at: at(2),
    })
    state = reduceRuntimeProfile(state, { type: 'host-restarted', at: at(3) })
    expect(state).toMatchObject({ status: 'interrupted', generation: 1 })
  })
})

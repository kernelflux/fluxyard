import {
  RuntimeNodeInvariantError,
  type RuntimeGeneration,
  type RuntimeLifecycleEvent,
  type RuntimeProfileDefinition,
  type RuntimeProfileState,
} from './model.ts'

export function createRuntimeProfileState(definition: RuntimeProfileDefinition): RuntimeProfileState {
  validateDefinition(definition)
  return {
    definition: structuredClone(definition),
    status: 'stopped',
    generation: 0 as RuntimeGeneration,
    consecutiveCrashes: 0,
    updatedAt: definition.createdAt,
  }
}

export function reduceRuntimeProfile(
  state: RuntimeProfileState,
  event: RuntimeLifecycleEvent,
): RuntimeProfileState {
  validateTimestamp(event.at, 'event timestamp')
  if (Date.parse(event.at) < Date.parse(state.updatedAt)) {
    fail('RUNTIME_TIME_REGRESSION', `${event.at} is before ${state.updatedAt}`)
  }

  if ('generation' in event && event.generation !== state.generation) {
    return state
  }

  switch (event.type) {
    case 'start-requested': {
      if (!['stopped', 'crashed', 'interrupted'].includes(state.status)) {
        fail('RUNTIME_START_NOT_ALLOWED', `cannot start a profile in ${state.status}`)
      }
      if (state.consecutiveCrashes >= state.definition.crashThreshold) {
        fail('RUNTIME_SAFE_MODE_REQUIRED', 'crash threshold requires explicit recovery')
      }
      return {
        ...state,
        status: 'starting',
        generation: (state.generation + 1) as RuntimeGeneration,
        lastHeartbeatAt: undefined,
        safeModeReason: undefined,
        updatedAt: event.at,
      }
    }
    case 'process-started': {
      requireStatus(state, ['starting'], event.type)
      return { ...state, status: 'healthy', lastHeartbeatAt: event.at, updatedAt: event.at }
    }
    case 'heartbeat': {
      requireStatus(state, ['starting', 'healthy', 'unhealthy'], event.type)
      return { ...state, status: 'healthy', lastHeartbeatAt: event.at, updatedAt: event.at }
    }
    case 'health-timeout': {
      requireStatus(state, ['healthy'], event.type)
      return { ...state, status: 'unhealthy', updatedAt: event.at }
    }
    case 'process-exited': {
      requireStatus(state, ['starting', 'healthy', 'unhealthy'], event.type)
      const lastExit = {
        generation: event.generation,
        at: event.at,
        expected: event.expected,
        reason: requireText(event.reason, 'exit reason'),
      }
      if (event.expected) {
        return {
          ...state,
          status: 'stopped',
          consecutiveCrashes: 0,
          lastHeartbeatAt: undefined,
          lastExit,
          updatedAt: event.at,
        }
      }
      const consecutiveCrashes = state.consecutiveCrashes + 1
      const safeMode = consecutiveCrashes >= state.definition.crashThreshold
      return {
        ...state,
        status: safeMode ? 'safe-mode' : 'crashed',
        consecutiveCrashes,
        lastHeartbeatAt: undefined,
        lastExit,
        safeModeReason: safeMode
          ? `${consecutiveCrashes} consecutive runtime crashes`
          : undefined,
        updatedAt: event.at,
      }
    }
    case 'recover-safe-mode': {
      requireStatus(state, ['safe-mode'], event.type)
      return {
        ...state,
        status: 'stopped',
        consecutiveCrashes: 0,
        safeModeReason: undefined,
        updatedAt: event.at,
      }
    }
    case 'host-restarted': {
      if (!['starting', 'healthy', 'unhealthy'].includes(state.status)) return state
      return {
        ...state,
        status: 'interrupted',
        lastHeartbeatAt: undefined,
        lastExit: {
          generation: state.generation,
          at: event.at,
          expected: false,
          reason: 'runtime host restarted without an observed process exit',
        },
        updatedAt: event.at,
      }
    }
  }
}

function validateDefinition(definition: RuntimeProfileDefinition): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(definition.id)) {
    fail('RUNTIME_PROFILE_ID_INVALID', 'profile id must be a portable identifier')
  }
  requireText(definition.displayName, 'profile displayName')
  requireText(definition.adapterKind, 'profile adapterKind')
  if (!Number.isSafeInteger(definition.crashThreshold) || definition.crashThreshold < 1) {
    fail('RUNTIME_CRASH_THRESHOLD_INVALID', 'crashThreshold must be a positive safe integer')
  }
  validateTimestamp(definition.createdAt, 'profile createdAt')
}

function requireStatus(state: RuntimeProfileState, allowed: readonly string[], event: string): void {
  if (!allowed.includes(state.status)) {
    fail('RUNTIME_TRANSITION_INVALID', `${event} is not valid while profile is ${state.status}`)
  }
}

function validateTimestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) fail('RUNTIME_TIMESTAMP_INVALID', `${field} must be ISO-compatible`)
}

function requireText(value: string, field: string): string {
  if (value.trim().length === 0) fail('RUNTIME_TEXT_INVALID', `${field} must be non-empty`)
  return value
}

function fail(code: string, message: string): never {
  throw new RuntimeNodeInvariantError(code, message)
}

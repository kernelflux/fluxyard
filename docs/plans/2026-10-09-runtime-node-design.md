# Runtime Node v0.2 Design

**Status:** Accepted  
**Decision:** Build and verify the runtime host lifecycle before integrating a real agent runtime.

## Architecture

The Runtime Node is the machine-local authority for runtime profiles and processes. It does not own enterprise Agent, Usage, Policy, or Audit facts; those remain in the Control Plane. A node exposes a runtime-neutral `RuntimeAdapter` contract, and each profile selects one adapter plus opaque adapter configuration. DeepSeek Harness will implement this contract after the lifecycle is stable.

The v0.2 state machine is deliberately small:

```text
stopped -> starting -> healthy
              |          |
              v          v
            crashed <- unhealthy
              |
      threshold reached
              v
           safe-mode
```

Every successful start creates a monotonically increasing generation. Exit callbacks carry that generation, so a late event from an old process cannot corrupt the current profile. A heartbeat updates observed health only for the active generation. Consecutive unexpected crashes are persisted; reaching the configured threshold enters Safe Mode and prevents automatic or manual start until an explicit recovery resets the crash window. Normal stop does not count as a crash.

Profile and lifecycle state are saved as a versioned snapshot through a store port. v0.2 uses an atomic JSON implementation, following the same local-first boundary as the Control Plane. The supervisor serializes mutations per profile and persists the new state before reporting success. Adapter processes remain outside the snapshot; after a host restart, previously active generations become `interrupted` and require a new start.

The Fake Adapter is production test infrastructure, not a demo shortcut. It provides controllable start, heartbeat and exit signals so race conditions, stale generations, crash thresholds and restart recovery are deterministic. The first real DeepSeek Harness adapter will be accepted only if it passes the same conformance suite.

## Non-goals

- Remote networking, enrollment tokens, mTLS and server heartbeats.
- Real DeepSeek Harness process launch or legacy patch migration.
- Automatic exponential restart, rolling upgrades or multi-process profiles.
- Secret values inside profile snapshots.

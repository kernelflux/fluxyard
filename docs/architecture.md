# Architecture

Fluxyard is an open control plane and native workbench for AI agents. It separates enterprise governance from any one agent runtime.

```text
Native Workbench / Admin Web / CLI
                 |
        Fluxyard Control Plane
       /       |         |     \
 Inventory   Usage     Policy  Evaluation
                 |
            Runtime Node
                 |
          Runtime Adapter
          /             \
DeepSeek Harness     other runtimes
```

## Ownership boundaries

- **Control Plane** owns workspace identity, inventory, normalized usage, policy, audit, evaluation and version lifecycle.
- **Runtime Node** owns profiles, processes, health, safe mode, last-known-good and adapter lifecycle on a machine.
- **Runtime Adapter** translates runtime-specific facts without changing their meaning.
- **Workbench** presents user workflows and never becomes the source of enterprise facts.

The first release is a modular monolith. Local JSON persistence is deliberately behind a store port so it can be replaced by SQLite locally and PostgreSQL for multi-user deployments.

## Runtime Node lifecycle

Each runtime Profile selects a runtime-neutral Adapter. Every start creates a
monotonically increasing generation; heartbeat and exit signals are accepted
only for the active generation, preventing delayed events from an old process
from corrupting current state.

Unexpected exits increment a persisted consecutive-crash counter. At the
configured threshold, the Profile enters Safe Mode and cannot start until an
operator explicitly recovers it. A normal stop resets the counter. If Fluxyard
restarts while a Profile was starting or active, the stored state becomes
`interrupted`; Fluxyard never assumes the external process completed or remains
healthy.

The current Fake Adapter makes lifecycle failures deterministic. Real adapters,
starting with DeepSeek Harness, must obey the same start, heartbeat, stop and
exit contract and pass the same conformance scenarios.

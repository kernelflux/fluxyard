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

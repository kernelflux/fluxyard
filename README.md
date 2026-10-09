# Fluxyard

**Open control plane and native workbench for AI agents.**

Fluxyard answers the operational questions that appear when agents move from experiments into daily work:

- Which agents and runtimes are active across employee devices, servers, and CI runners?
- Who owns them, what did they execute, and what did each run cost?
- Which tools, models, skills, and releases are allowed?
- Can an organization audit, evaluate, recover, and improve an agent without being locked to one runtime?

Fluxyard is runtime-neutral. DeepSeek Harness will be its first full adapter, while the control plane remains usable by other agent runtimes.

## Status

Fluxyard is pre-alpha. v0.1 establishes the local control-plane facts and CLI before adding a Runtime Node, native macOS Workbench, admin web interface, or multi-user server.

## Architecture

```text
Native Workbench / Admin Web / CLI
                 |
        Fluxyard Control Plane
                 |
            Runtime Node
                 |
          Runtime Adapter
          /             \
DeepSeek Harness     other runtimes
```

The Control Plane owns inventory, usage, policy, audit, evaluation and lifecycle. A Runtime Node owns local profiles, processes, health and recovery. Runtime adapters translate facts without forcing Fluxyard's enterprise model into the runtime.

See [Architecture](docs/architecture.md) and the [v0.1 implementation plan](docs/plans/2026-10-09-v0.1-foundation.md).

## Quick start

Requirements: Node.js 22.19+ and pnpm 11.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm fluxyard demo
```

The demo stores local state in `.fluxyard/control-plane.json` and prints a structured usage summary. Running it again is idempotent.

## Roadmap

- **v0.1:** Agent inventory, immutable usage ledger, durable local store, CLI demo.
- **v0.2:** Runtime Node identity, heartbeat, profiles, safe mode, DeepSeek Harness adapter.
- **v0.3:** Native macOS Workbench and local run/usage views.
- **v0.4:** Enterprise server, OIDC, RBAC, policy, budgets, audit and admin UI.
- **v0.5:** Evaluation and release gates; Windows and mobile companion clients.

## Principles

- Runtime-neutral control-plane facts.
- Local-first without creating a separate personal architecture.
- Append-only evidence for metering and audit.
- Deterministic code for permissions and side effects; agents for judgment.
- One modular monolith before any microservices.

## License

Apache License 2.0. See [LICENSE](LICENSE).

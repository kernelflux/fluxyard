# Fluxyard

**Open control plane and native workbench for AI agents.**

Fluxyard answers the operational questions that appear when agents move from experiments into daily work:

- Which agents and runtimes are active across employee devices, servers, and CI runners?
- Who owns them, what did they execute, and what did each run cost?
- Which tools, models, skills, and releases are allowed?
- Can an organization audit, evaluate, recover, and improve an agent without being locked to one runtime?

Fluxyard is runtime-neutral. DeepSeek Harness will be its first full adapter, while the control plane remains usable by other agent runtimes.

## Status

Fluxyard is pre-alpha. v0.1 established local control-plane facts and the CLI;
v0.2 adds the durable Runtime Node lifecycle before integrating a real runtime.

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

See [Architecture](docs/architecture.md), the [v0.1 foundation plan](docs/plans/2026-10-09-v0.1-foundation.md),
and the [v0.2 Runtime Node design](docs/plans/2026-10-09-runtime-node-design.md).

## Quick start

Requirements: Node.js 22.19+ and pnpm 11.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm fluxyard demo
pnpm fluxyard runtime demo
```

The control-plane demo stores local state in `.fluxyard/control-plane.json` and
prints a structured usage summary. The Runtime Node demo uses
`.fluxyard/runtime-node.json`, crashes three fake process generations, opens the
Safe Mode circuit and reloads the persisted state.

## Roadmap

- **v0.1:** Agent inventory, immutable usage ledger, durable local store, CLI demo.
- **v0.2:** Runtime profiles, heartbeat, generations, crash circuit breaking and Safe Mode.
- **v0.3:** Runtime Node enrollment and the first DeepSeek Harness adapter.
- **v0.4:** Native macOS Workbench and local run/usage views.
- **v0.5:** Enterprise server, OIDC, RBAC, policy, budgets, audit and admin UI.
- **v0.6:** Evaluation and release gates; Windows and mobile companion clients.

## Principles

- Runtime-neutral control-plane facts.
- Local-first without creating a separate personal architecture.
- Append-only evidence for metering and audit.
- Deterministic code for permissions and side effects; agents for judgment.
- One modular monolith before any microservices.

## Repository layout

```text
apps/cli/             Local operator workflow and demo
packages/core/        Runtime-neutral control-plane domain
packages/store-json/  Atomic local persistence for evaluation
packages/runtime-node/ Runtime profiles, supervision, recovery and adapter contract
docs/                 Architecture and implementation plans
```

## v0.2 limitations

The JSON stores are deliberately single-process and local-only. v0.2 has no
authentication, network listener, secret management, real runtime adapter or
production database. Safe Mode recovery is explicit and automatic backoff is
not implemented yet. Those capabilities will be added around the tested domain
rather than embedded into it.

## License

Apache License 2.0. See [LICENSE](LICENSE).

# Contributing

Fluxyard is pre-alpha and its public contracts will evolve. Start with an issue describing the user problem and proposed boundary before large changes.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
```

Keep runtime-specific concepts behind adapters. New control-plane facts need tests for tenant boundaries, replay behavior, persistence and malformed input. Do not commit credentials or local `.fluxyard` data.

Use focused conventional commits such as `feat(core): ...`, `fix(storage): ...`, and `docs: ...`.

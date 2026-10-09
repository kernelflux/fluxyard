# Fluxyard contributor instructions

- Keep control-plane types runtime-neutral. DeepSeek Harness and other runtime concepts belong in adapters.
- Preserve immutable usage facts: retries must be idempotent and conflicting replays must fail loudly.
- Enforce Workspace boundaries in the domain layer, not only in UI or API handlers.
- Represent money as integer micro-units and validate safe-integer aggregation.
- Add focused tests for every domain invariant, persistence failure and command behavior.
- Prefer a modular monolith until measured product needs justify a service boundary.
- Run `pnpm typecheck`, `pnpm test`, and the CLI demo before submitting changes.

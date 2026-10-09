# Changelog

All notable changes to Fluxyard will be documented in this file.

## [Unreleased]

### Added

- Runtime-neutral profile and adapter contracts.
- Generation-safe runtime lifecycle with heartbeat health and stale-event rejection.
- Consecutive-crash circuit breaker, Safe Mode and explicit recovery.
- Durable Runtime Node supervisor with restart interruption recovery.
- Atomic local Runtime Node state storage and strict snapshot validation.
- Fake Runtime Adapter and `fluxyard runtime demo` recovery scenario.
- Runtime-neutral Workspace, Runtime Node and Agent inventory.
- Immutable model, tool and runtime usage events.
- Tenant, adapter, replay, ordering and safe-integer invariants.
- Atomic local JSON persistence with schema and fact validation.
- Structured CLI commands for inventory, usage and an idempotent demo.
- Architecture, security, contribution and v0.1 implementation documentation.

### Known limitations

- The JSON store is single-process and intended for local evaluation only.
- Authentication, authorization, policy and audit retention are not implemented.
- Runtime Node networking and the DeepSeek Harness adapter are not implemented.
- The CLI runs from source and is not yet published as a compiled package.

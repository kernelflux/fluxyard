# Changelog

All notable changes to Fluxyard will be documented in this file.

## [Unreleased]

### Added

- Runtime-neutral Workspace, Runtime Node and Agent inventory.
- Immutable model, tool and runtime usage events.
- Tenant, adapter, replay, ordering and safe-integer invariants.
- Atomic local JSON persistence with schema and fact validation.
- Structured CLI commands for inventory, usage and an idempotent demo.
- Architecture, security, contribution and v0.1 implementation documentation.

### Known limitations

- The JSON store is single-process and intended for local evaluation only.
- Authentication, authorization, policy and audit retention are not implemented.
- Runtime Nodes and the DeepSeek Harness adapter are planned for v0.2.
- The CLI runs from source and is not yet published as a compiled package.

# Runtime Node v0.2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a durable Runtime Node supervisor with profiles, generation-safe process lifecycle, heartbeat health, crash circuit breaking, Safe Mode and a deterministic fake adapter.

**Architecture:** Add a runtime-neutral adapter contract and pure lifecycle reducer, then compose them in a supervisor that persists every accepted transition through a versioned store. A fake adapter drives conformance and recovery tests; no DeepSeek Harness code enters the core packages.

**Tech Stack:** Node.js 22+, TypeScript 6, Vitest, pnpm, atomic JSON snapshots.

---

### Task 1: Define the Runtime Node contracts and lifecycle reducer

**Files:**

- Create: `packages/runtime-node/package.json`
- Create: `packages/runtime-node/src/model.ts`
- Create: `packages/runtime-node/src/lifecycle.ts`
- Create: `packages/runtime-node/src/index.ts`
- Test: `packages/runtime-node/test/lifecycle.test.ts`

**Steps:**

1. Write failing tests for start, heartbeat, normal stop, unexpected exit, stale generation and Safe Mode.
2. Run the focused test and verify missing exports fail.
3. Implement discriminated lifecycle events and a pure reducer with fail-loud invariants.
4. Verify focused tests and type checking.
5. Commit `feat(runtime): define generation-safe node lifecycle`.

### Task 2: Add profiles and durable supervisor state

**Files:**

- Create: `packages/runtime-node/src/supervisor.ts`
- Test: `packages/runtime-node/test/supervisor.test.ts`

**Steps:**

1. Test profile registration, adapter selection, serialized mutations and persisted transitions.
2. Add `RuntimeNodeStateStore` and `RuntimeAdapter` ports.
3. Implement start, stop, heartbeat, unexpected exit and explicit Safe Mode recovery.
4. Convert active profiles to interrupted state when loading after host restart.
5. Verify tests and commit `feat(runtime): supervise durable runtime profiles`.

### Task 3: Implement atomic local state storage

**Files:**

- Create: `packages/runtime-node/src/json-state-store.ts`
- Test: `packages/runtime-node/test/json-state-store.test.ts`

**Steps:**

1. Test missing files, round-trip, private permissions and corrupt snapshots.
2. Implement temporary-file write, fsync and atomic rename.
3. Validate schema version before returning state.
4. Verify full tests and commit `feat(runtime): persist node state atomically`.

### Task 4: Add the fake adapter and runnable recovery demo

**Files:**

- Create: `packages/runtime-node/src/fake-adapter.ts`
- Create: `apps/cli/src/runtime-demo.ts`
- Modify: `apps/cli/src/main.ts`
- Test: `packages/runtime-node/test/fake-adapter.test.ts`
- Test: `apps/cli/test/runtime-demo.test.ts`

**Steps:**

1. Test controlled heartbeats and exits through the real supervisor.
2. Implement a fake process handle whose signals include generation.
3. Add `fluxyard runtime demo` that crashes three generations, enters Safe Mode, reloads persisted state and prints structured JSON.
4. Run the command twice against separate temporary state files.
5. Commit `feat(cli): demonstrate runtime crash recovery`.

### Task 5: Release verification and pull request

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/architecture.md`

**Steps:**

1. Document Runtime Node boundaries, command and limitations.
2. Run typecheck, all tests and the runtime demo in a clean checkout.
3. Push `feat/runtime-node-v02` and create a focused PR against `main`.
4. Wait for CI and address failures before handoff.

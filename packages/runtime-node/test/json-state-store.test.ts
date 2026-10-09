import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  JsonRuntimeNodeStateStore,
  RuntimeNodeSupervisor,
  type RuntimeNodeStateSnapshot,
  type RuntimeProfileId,
} from '../src/index.ts'

describe('JsonRuntimeNodeStateStore', () => {
  it('treats a missing file as empty state and round-trips private snapshots', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluxyard-runtime-store-'))
    const path = join(directory, 'nested', 'runtime-node.json')
    const store = new JsonRuntimeNodeStateStore(path)
    expect(await store.load()).toEqual({ schemaVersion: 1, profiles: [] })

    const snapshot: RuntimeNodeStateSnapshot = { schemaVersion: 1, profiles: [] }
    await store.save(snapshot)
    expect(await store.load()).toEqual(snapshot)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(snapshot)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('rejects malformed JSON and unsupported snapshot versions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluxyard-runtime-store-'))
    const path = join(directory, 'runtime-node.json')
    const store = new JsonRuntimeNodeStateStore(path)
    await writeFile(path, '{broken', 'utf8')
    await expect(store.load()).rejects.toThrow(/RUNTIME_STORE_JSON_INVALID/)
    await writeFile(path, JSON.stringify({ schemaVersion: 2, profiles: [] }), 'utf8')
    await expect(store.load()).rejects.toThrow(/RUNTIME_STORE_SCHEMA_INVALID/)
  })

  it('fails loudly when persisted profile facts violate lifecycle invariants', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluxyard-runtime-store-'))
    const path = join(directory, 'runtime-node.json')
    const store = new JsonRuntimeNodeStateStore(path)
    await writeFile(path, JSON.stringify({
      schemaVersion: 1,
      profiles: [{
        definition: {
          id: 'profile-invalid' as RuntimeProfileId,
          displayName: 'Invalid',
          adapterKind: 'stub',
          crashThreshold: 3,
          config: {},
          createdAt: '2026-10-09T08:00:00.000Z',
        },
        status: 'safe-mode',
        generation: 1,
        consecutiveCrashes: 1,
        safeModeReason: 'not enough crashes',
        updatedAt: '2026-10-09T08:00:01.000Z',
      }],
    }), 'utf8')

    await expect(RuntimeNodeSupervisor.open({
      store,
      adapters: [{ kind: 'stub', start: async () => ({ stop: async () => undefined }) }],
    })).rejects.toThrow(/RUNTIME_SAFE_MODE_INVALID/)
  })
})

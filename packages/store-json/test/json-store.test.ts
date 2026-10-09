import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type WorkspaceId } from '@fluxyard/core'
import { JsonControlPlaneStore } from '../src/index.ts'

describe('JsonControlPlaneStore', () => {
  it('persists and restores validated control-plane facts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluxyard-store-'))
    const path = join(directory, 'nested', 'control-plane.json')
    const store = new JsonControlPlaneStore(path)
    const workspaceId = 'workspace-acme' as WorkspaceId
    const plane = await store.load()
    plane.registerWorkspace({ id: workspaceId, name: 'Acme', createdAt: '2026-10-09T08:00:00.000Z' })

    await store.save(plane)

    const restored = await store.load()
    expect(restored.listWorkspaces()).toEqual(plane.listWorkspaces())
    expect(JSON.parse(await readFile(path, 'utf8')).schemaVersion).toBe(1)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('rejects unsupported or malformed snapshots instead of resetting data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluxyard-store-'))
    const path = join(directory, 'control-plane.json')
    const store = new JsonControlPlaneStore(path)

    await writeFile(path, JSON.stringify({ schemaVersion: 2 }), 'utf8')
    await expect(store.load()).rejects.toThrow(/STORE_SCHEMA_INVALID/)

    await writeFile(path, '{broken', 'utf8')
    await expect(store.load()).rejects.toThrow(/STORE_JSON_INVALID/)
  })

  it('treats a missing file as an empty control plane', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluxyard-store-'))
    const store = new JsonControlPlaneStore(join(directory, 'missing.json'))
    expect((await store.load()).snapshot().usageEvents).toEqual([])
  })
})

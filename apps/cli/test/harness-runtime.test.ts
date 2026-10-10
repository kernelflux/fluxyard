import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createRuntimeProfileState, reduceRuntimeProfile, type RuntimeGeneration, type RuntimeProfileId } from '@fluxyard/runtime-node'
import { runCli } from '../src/main.ts'

describe('Harness operator commands', () => {
  it('checks the installed launcher version without claiming SDK readiness', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluxyard-doctor-'))
    try {
      const file = join(directory, 'config.json')
      await writeFile(file, JSON.stringify({ cliEntry: fileURLToPath(new URL('../../../packages/runtime-node/test/fixtures/sdk-process.mjs', import.meta.url)), workingDirectory: directory, homeDirectory: join(directory, 'home'), provider: 'deepseek-official', model: 'deepseek-official' }))
      const output: string[] = []
      expect(await runCli(['runtime', 'harness', 'doctor', file], { cwd: directory, write: line => output.push(line) })).toBe(0)
      expect(JSON.parse(output[0]!)).toMatchObject({ version: '0.2.1-alpha.2', readinessVerified: false })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('counts early exits once, trips persisted Safe Mode and explicitly recovers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluxyard-recover-'))
    try {
      const file = join(directory, 'config.json')
      await writeFile(file, JSON.stringify({ cliEntry: fileURLToPath(new URL('../../../packages/runtime-node/test/fixtures/sdk-process.mjs', import.meta.url)), workingDirectory: directory, homeDirectory: join(directory, 'home'), provider: 'deepseek-official', model: 'deepseek-official' }))
      const outputs: string[] = []
      const options = { cwd: directory, env: { ...process.env, FLUXYARD_FIXTURE_MODE: 'early-exit' }, write: (line: string) => outputs.push(line) }
      for (let count = 1; count <= 3; count++) {
        expect(await runCli(['runtime', 'harness', 'start', file], options)).toBe(1)
        expect(JSON.parse(outputs.at(-1)!).profile.consecutiveCrashes).toBe(count)
      }
      await expect(runCli(['runtime', 'harness', 'start', file], options)).rejects.toThrow('RUNTIME_START_NOT_ALLOWED')
      await runCli(['runtime', 'harness', 'status'], options)
      expect(JSON.parse(outputs.at(-1)!).result[0].status).toBe('safe-mode')
      await runCli(['runtime', 'harness', 'recover'], options)
      expect(JSON.parse(outputs.at(-1)!).result).toMatchObject({ status: 'stopped', consecutiveCrashes: 0, generation: 3 })
      expect(await runCli(['runtime', 'harness', 'start', file], options)).toBe(1)
      expect(JSON.parse(outputs.at(-1)!).profile).toMatchObject({ consecutiveCrashes: 1, generation: 4 })
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('status is read-only and recovery refuses an active generation without rewriting it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluxyard-status-'))
    try {
      const file = join(directory, 'runtime-node.json')
      const at = new Date().toISOString()
      const initial = createRuntimeProfileState({ id: 'harness-local' as RuntimeProfileId, displayName: 'test', adapterKind: 'deepseek-harness', config: {}, crashThreshold: 3, createdAt: at })
      const starting = reduceRuntimeProfile(initial, { type: 'start-requested', at })
      const healthy = reduceRuntimeProfile(starting, { type: 'process-started', generation: 1 as RuntimeGeneration, at })
      const source = JSON.stringify({ schemaVersion: 1, profiles: [healthy] })
      await writeFile(file, source)
      const options = { cwd: directory, write: () => {} }
      await runCli(['runtime', 'harness', 'status', '--data', file], options)
      await expect(runCli(['runtime', 'harness', 'recover', '--data', file], options)).rejects.toThrow('RUNTIME_TRANSITION_INVALID')
      expect(await readFile(file, 'utf8')).toBe(source)
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('rejects missing configuration before spawning', async () => {
    await expect(runCli(['runtime', 'harness', 'start'])).rejects.toThrow('usage: runtime harness')
  })
})

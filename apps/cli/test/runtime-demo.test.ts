import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/main.ts'

describe('runtime demo', () => {
  it('persists three crashes, opens the circuit and survives host reopen', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluxyard-runtime-demo-'))
    const path = join(directory, 'runtime-node.json')
    const output: string[] = []
    await runCli(['runtime', 'demo', '--data', path], { write: line => output.push(line) })

    const result = JSON.parse(output[0]!).result
    expect(result.circuitOpen).toBe(true)
    expect(result.beforeRestart).toMatchObject({
      status: 'safe-mode', generation: 3, consecutiveCrashes: 3,
    })
    expect(result.afterRestart).toEqual(result.beforeRestart)
    await runCli(['runtime', 'demo', '--data', path], { write: line => output.push(line) })
    expect(JSON.parse(output[1]!).result.afterRestart).toEqual(result.afterRestart)
  })

  it('uses a runtime-specific default state file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluxyard-runtime-demo-'))
    const output: string[] = []
    await runCli(['runtime', 'demo'], { cwd: directory, write: line => output.push(line) })
    expect(JSON.parse(output[0]!).dataPath).toBe(join(directory, '.fluxyard', 'runtime-node.json'))
  })
})

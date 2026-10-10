import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCli } from '../src/main.ts'

describe('Fluxyard CLI', () => {
  it('runs the demo twice without duplicating usage', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluxyard-cli-'))
    const dataPath = join(directory, 'control-plane.json')
    const output: string[] = []

    await runCli(['demo', '--data', dataPath], { write: line => output.push(line) })
    await runCli(['demo', '--data', dataPath], { write: line => output.push(line) })

    const first = JSON.parse(output[0]!)
    const second = JSON.parse(output[1]!)
    expect(first.result.registrations.usage).toBe('appended')
    expect(second.result.registrations).toEqual({
      workspace: 'existing', node: 'existing', agent: 'existing', usage: 'duplicate',
    })
    expect(second.result.usage.eventCount).toBe(1)
    expect(second.result.usage.costMicros).toBe(12_345)
  })

  it('returns inventory and summaries as structured JSON', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluxyard-cli-'))
    const dataPath = join(directory, 'control-plane.json')
    const output: string[] = []
    const write = (line: string) => output.push(line)

    await runCli(['demo', '--data', dataPath], { write })
    await runCli(['inventory', 'list', 'workspace-demo', '--data', dataPath], { write })
    await runCli(['usage', 'summary', 'workspace-demo', '--data', dataPath], { write })

    expect(JSON.parse(output[1]!).result.agents[0].name).toBe('Release Agent')
    expect(JSON.parse(output[2]!).result.inputTokens).toBe(1_000)
  })

  it('rejects unknown commands without modifying state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluxyard-cli-'))
    await expect(runCli(['unknown'], { cwd: directory })).rejects.toThrow(/unknown command/)
  })
})

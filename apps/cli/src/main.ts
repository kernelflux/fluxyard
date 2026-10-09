#!/usr/bin/env node

import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  type AgentId,
  type RunId,
  type RuntimeNode,
  type RuntimeNodeId,
  type UsageEvent,
  type WorkspaceId,
} from '@fluxyard/core'
import { JsonControlPlaneStore } from '@fluxyard/store-json'

export interface CliOptions {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly now?: () => string
  readonly write?: (line: string) => void
}

export async function runCli(rawArgs: readonly string[], options: CliOptions = {}): Promise<number> {
  const write = options.write ?? console.log
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const { args, dataPath } = extractDataPath(rawArgs, env.FLUXYARD_DATA ?? join(cwd, '.fluxyard', 'control-plane.json'))
  const store = new JsonControlPlaneStore(dataPath)
  const plane = await store.load()
  const now = options.now ?? (() => new Date().toISOString())

  const [group, action, ...values] = args
  if (!group || group === 'help' || group === '--help' || group === '-h') {
    write(JSON.stringify({ ok: true, commands: HELP_COMMANDS }, null, 2))
    return 0
  }

  let result: unknown
  let mutated = false

  if (group === 'demo') {
    result = runDemo(plane)
    mutated = true
  } else if (group === 'workspace' && action === 'add') {
    const [id, ...nameParts] = values
    requireArgs(Boolean(id && nameParts.length), 'workspace add <id> <name>')
    result = plane.registerWorkspace({
      id: id as WorkspaceId,
      name: nameParts.join(' '),
      createdAt: now(),
    })
    mutated = true
  } else if (group === 'node' && action === 'add') {
    const [workspace, id, platform, adapterKind, adapterVersion, ...displayNameParts] = values
    requireArgs(Boolean(workspace && id && platform && adapterKind && adapterVersion && displayNameParts.length),
      'node add <workspace-id> <node-id> <platform> <adapter-kind> <adapter-version> <display-name>')
    result = plane.registerRuntimeNode({
      id: id as RuntimeNodeId,
      workspaceId: workspace as WorkspaceId,
      displayName: displayNameParts.join(' '),
      platform: parsePlatform(platform),
      adapters: [{ kind: adapterKind, version: adapterVersion, capabilities: [] }],
      createdAt: now(),
    })
    mutated = true
  } else if (group === 'agent' && action === 'add') {
    const [workspace, node, id, owner, runtimeKind, version, ...nameParts] = values
    requireArgs(Boolean(workspace && node && id && owner && runtimeKind && version && nameParts.length),
      'agent add <workspace-id> <node-id> <agent-id> <owner-id> <runtime-kind> <version> <name>')
    result = plane.registerAgent({
      id: id as AgentId,
      workspaceId: workspace as WorkspaceId,
      runtimeNodeId: node as RuntimeNodeId,
      name: nameParts.join(' '),
      ownerId: owner,
      runtimeKind,
      version,
      createdAt: now(),
    })
    mutated = true
  } else if (group === 'usage' && action === 'record') {
    requireArgs(values.length === 1, "usage record '<event-json>'")
    result = plane.recordUsage(parseUsageEvent(values[0]!))
    mutated = true
  } else if (group === 'usage' && action === 'summary') {
    const [workspace, agent, run] = values
    requireArgs(Boolean(workspace), 'usage summary <workspace-id> [agent-id] [run-id]')
    result = plane.summarizeUsage({
      workspaceId: workspace as WorkspaceId,
      agentId: agent as AgentId | undefined,
      runId: run as RunId | undefined,
    })
  } else if (group === 'inventory' && action === 'list') {
    const [workspace] = values
    requireArgs(Boolean(workspace), 'inventory list <workspace-id>')
    result = {
      nodes: plane.listRuntimeNodes(workspace as WorkspaceId),
      agents: plane.listAgents(workspace as WorkspaceId),
    }
  } else {
    throw new CliUsageError(`unknown command: ${args.join(' ')}`)
  }

  if (mutated) await store.save(plane)
  write(JSON.stringify({ ok: true, dataPath, result }, null, 2))
  return 0
}

const HELP_COMMANDS = [
  'demo',
  'workspace add <id> <name>',
  'node add <workspace-id> <node-id> <platform> <adapter-kind> <adapter-version> <display-name>',
  'agent add <workspace-id> <node-id> <agent-id> <owner-id> <runtime-kind> <version> <name>',
  "usage record '<event-json>'",
  'usage summary <workspace-id> [agent-id] [run-id]',
  'inventory list <workspace-id>',
]

function runDemo(plane: import('@fluxyard/core').AgentControlPlane): object {
  const at = '2026-10-09T08:00:00.000Z'
  const workspaceId = 'workspace-demo' as WorkspaceId
  const runtimeNodeId = 'node-local' as RuntimeNodeId
  const agentId = 'agent-release' as AgentId

  const workspace = plane.registerWorkspace({ id: workspaceId, name: 'Fluxyard Demo', createdAt: at })
  const node = plane.registerRuntimeNode({
    id: runtimeNodeId,
    workspaceId,
    displayName: 'Local Runtime Node',
    platform: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
    adapters: [{ kind: 'deepseek-harness', version: 'adapter-preview', capabilities: ['session', 'delivery'] }],
    createdAt: at,
  })
  const agent = plane.registerAgent({
    id: agentId,
    workspaceId,
    runtimeNodeId,
    name: 'Release Agent',
    ownerId: 'team-platform',
    runtimeKind: 'deepseek-harness',
    version: '0.1.0',
    createdAt: at,
  })
  const usage = plane.recordUsage({
    id: 'usage-demo-model' as UsageEvent['id'],
    workspaceId,
    runtimeNodeId,
    agentId,
    runId: 'run-demo' as UsageEvent['runId'],
    sequence: 0,
    occurredAt: at,
    kind: 'model',
    provider: 'deepseek-official',
    model: 'deepseek-chat',
    inputTokens: 1_000,
    outputTokens: 250,
    cacheReadTokens: 300,
    costMicros: 12_345,
  })

  return {
    registrations: { workspace, node, agent, usage },
    inventory: { nodes: plane.listRuntimeNodes(workspaceId), agents: plane.listAgents(workspaceId) },
    usage: plane.summarizeUsage({ workspaceId }),
  }
}

function extractDataPath(args: readonly string[], fallback: string): { args: string[]; dataPath: string } {
  const result = [...args]
  const index = result.indexOf('--data')
  if (index < 0) return { args: result, dataPath: fallback }
  const path = result[index + 1]
  if (!path) throw new CliUsageError('--data requires a path')
  result.splice(index, 2)
  return { args: result, dataPath: path }
}

function parseUsageEvent(source: string): UsageEvent {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw new CliUsageError(`usage event is not valid JSON: ${String(error)}`)
  }
  if (!value || typeof value !== 'object' || typeof (value as Record<string, unknown>).kind !== 'string') {
    throw new CliUsageError('usage event must be a JSON object with a kind')
  }
  return value as UsageEvent
}

function parsePlatform(value: string): RuntimeNode['platform'] {
  if (value === 'macos' || value === 'windows' || value === 'linux' || value === 'ios' || value === 'android') {
    return value
  }
  throw new CliUsageError(`unsupported platform: ${value}`)
}

function requireArgs(condition: boolean, usage: string): asserts condition {
  if (!condition) throw new CliUsageError(`usage: fluxyard ${usage}`)
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CliUsageError'
  }
}

async function main(): Promise<void> {
  try {
    process.exitCode = await runCli(process.argv.slice(2))
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
    }, null, 2))
    process.exitCode = error instanceof CliUsageError ? 2 : 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()

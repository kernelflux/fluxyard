import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { access, mkdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { RuntimeNodeInvariantError, type RuntimeAdapter, type RuntimeAdapterStartRequest, type RuntimeProcessHandle } from './model.ts'

/** Only launch configuration is persisted. Credentials are inherited at spawn time. */
export interface HarnessLaunchConfig {
  readonly nodeExecutable?: string
  readonly cliEntry: string
  readonly workingDirectory: string
  readonly homeDirectory: string
  readonly provider: string
  readonly model: string
}

export interface HarnessAdapterOptions {
  readonly nodeExecutable?: string
  readonly nodeArguments?: readonly string[]
  readonly environment?: NodeJS.ProcessEnv
  readonly startupTimeoutMs?: number
  readonly heartbeatIntervalMs?: number
  readonly stopTimeoutMs?: number
  readonly onFault?: (error: unknown) => void
}

export function parseHarnessConfig(value: Readonly<Record<string, unknown>>): HarnessLaunchConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeNodeInvariantError('HARNESS_CONFIG_INVALID', 'configuration must be an object')
  }
  const allowed = ['cliEntry', 'workingDirectory', 'homeDirectory', 'provider', 'model']
  if (Object.keys(value).some(key => !allowed.includes(key) && key !== 'nodeExecutable')) {
    throw new RuntimeNodeInvariantError('HARNESS_CONFIG_INVALID', 'unsupported configuration field; do not store secrets in profiles')
  }
  for (const key of allowed) {
    if (typeof value[key] !== 'string' || !(value[key] as string).trim()) {
      throw new RuntimeNodeInvariantError('HARNESS_CONFIG_INVALID', `${key} must be a nonempty string`)
    }
  }
  for (const key of allowed.slice(0, 3)) {
    if (!isAbsolute(value[key] as string)) throw new RuntimeNodeInvariantError('HARNESS_CONFIG_INVALID', `${key} must be absolute`)
  }
  if (value.nodeExecutable !== undefined && (typeof value.nodeExecutable !== 'string' || !isAbsolute(value.nodeExecutable))) {
    throw new RuntimeNodeInvariantError('HARNESS_CONFIG_INVALID', 'nodeExecutable must be absolute')
  }
  if (!/\.(?:js|mjs|cjs)$/.test(value.cliEntry as string)) {
    throw new RuntimeNodeInvariantError('HARNESS_CONFIG_INVALID', 'cliEntry must be a built JavaScript launcher')
  }
  return value as unknown as HarnessLaunchConfig
}

export class HarnessRuntimeAdapter implements RuntimeAdapter {
  readonly kind = 'deepseek-harness'
  private readonly options: Required<Omit<HarnessAdapterOptions, 'environment'>> & { environment: NodeJS.ProcessEnv }
  private readonly homes = new Set<string>()

  constructor(options: HarnessAdapterOptions = {}) {
    this.options = {
      nodeExecutable: options.nodeExecutable ?? process.execPath,
      nodeArguments: options.nodeArguments ?? [],
      environment: options.environment ?? process.env,
      startupTimeoutMs: options.startupTimeoutMs ?? 30_000,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? 5_000,
      stopTimeoutMs: options.stopTimeoutMs ?? 6_000,
      onFault: options.onFault ?? (() => undefined),
    }
    for (const duration of [this.options.startupTimeoutMs, this.options.heartbeatIntervalMs, this.options.stopTimeoutMs]) {
      if (!Number.isSafeInteger(duration) || duration < 1) throw new Error('adapter timeouts must be positive integers')
    }
  }

  async start(request: RuntimeAdapterStartRequest): Promise<HarnessRuntimeProcess> {
    const config = parseHarnessConfig(request.profile.config)
    await access(config.cliEntry)
    if (!(await stat(config.workingDirectory)).isDirectory()) throw new Error('HARNESS_WORKSPACE_INVALID')
    await mkdir(config.homeDirectory, { recursive: true, mode: 0o700 })
    const home = await realpath(config.homeDirectory)
    if (this.homes.has(home)) throw new Error('HARNESS_HOME_IN_USE: another generation owns this home')
    this.homes.add(home)
    const child = spawn(config.nodeExecutable ?? this.options.nodeExecutable, [...this.options.nodeArguments, config.cliEntry, '--profile', 'sdk'], {
      cwd: config.workingDirectory,
      env: { ...this.options.environment, DSH_HOME: home, DSH_TELEMETRY_MODE: 'DISABLED' },
      shell: false,
      stdio: 'pipe',
      detached: process.platform !== 'win32',
    })
    const handle = new HarnessRuntimeProcess(child, request, this.options, () => this.homes.delete(home))
    try {
      const result = await handle.rpc('initialize', {
        cwd: config.workingDirectory, provider: config.provider, model: config.model,
      }, this.options.startupTimeoutMs) as { serverInfo?: { name?: string; version?: string } }
      if (result?.serverInfo?.name !== 'deepseek-harness-sdk-runtime' || typeof result.serverInfo.version !== 'string') {
        throw new Error('HARNESS_HANDSHAKE_INVALID')
      }
      handle.serverVersion = result.serverInfo.version
      handle.beginHeartbeat()
      return handle
    } catch (error) {
      await handle.stop('startup failed')
      // Never persist arbitrary runtime error text: it may contain credentials or tool input.
      const safeCodes = ['HARNESS_HANDSHAKE_INVALID', 'HARNESS_RPC_TIMEOUT', 'HARNESS_RPC_REJECTED', 'HARNESS_RPC_INVALID', 'HARNESS_PIPE_CLOSED', 'HARNESS_PROCESS_EXITED', 'HARNESS_FRAME_TOO_LARGE', 'HARNESS_NOT_RUNNING']
      const code = error instanceof Error && safeCodes.includes(error.message) ? error.message : 'HARNESS_INITIALIZATION_FAILED'
      throw new Error(`HARNESS_START_FAILED: ${code}`)
    }
  }
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

export class HarnessRuntimeProcess implements RuntimeProcessHandle {
  serverVersion = ''
  readonly pid: number | undefined
  private readonly pending = new Map<number, Pending>()
  private nextId = 0
  private buffer = ''
  private closed = false
  private stopping = false
  private activated = false
  private stopTask?: Promise<void>
  private heartbeat?: ReturnType<typeof setInterval>
  private readonly exited: Promise<void>

  private readonly child: ChildProcessWithoutNullStreams
  private readonly request: RuntimeAdapterStartRequest
  private readonly options: Required<Omit<HarnessAdapterOptions, 'environment'>> & { environment: NodeJS.ProcessEnv }

  constructor(
    child: ChildProcessWithoutNullStreams,
    request: RuntimeAdapterStartRequest,
    options: Required<Omit<HarnessAdapterOptions, 'environment'>> & { environment: NodeJS.ProcessEnv },
    release: () => void,
  ) {
    this.child = child
    this.request = request
    this.options = options
    this.pid = child.pid
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.receive(chunk))
    // Drain diagnostics without storing untrusted text or secrets in the lifecycle ledger.
    child.stderr.resume()
    child.stdin.on('error', () => this.rejectPending('HARNESS_PIPE_CLOSED'))
    this.exited = new Promise(resolve => {
      const finish = (reason: string) => {
        if (this.closed) return
        // Reap descendants even when the parent exits before they do.
        if (process.platform !== 'win32' && child.pid) {
          try { process.kill(-child.pid, 'SIGKILL') } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') this.options.onFault(error)
          }
        }
        this.closed = true
        clearInterval(this.heartbeat)
        this.rejectPending('HARNESS_PROCESS_EXITED')
        release()
        resolve()
        if (!this.stopping && this.activated) this.dispatch(() => request.onExit({ at: new Date().toISOString(), reason }))
      }
      child.once('error', () => finish('HARNESS_SPAWN_FAILED'))
      child.once('exit', (code, signal) => finish(`HARNESS_EXIT: code=${code}; signal=${signal}`))
    })
  }

  rpc(method: string, params: unknown, timeoutMs = this.options.startupTimeoutMs): Promise<unknown> {
    if (this.closed || this.stopping) return Promise.reject(new Error('HARNESS_NOT_RUNNING'))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('HARNESS_RPC_TIMEOUT'))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, error => {
        if (error) {
          clearTimeout(timer)
          this.pending.delete(id)
          reject(new Error('HARNESS_PIPE_CLOSED'))
        }
      })
    })
  }

  beginHeartbeat(): void {
    if (this.closed || this.stopping) throw new Error('HARNESS_NOT_RUNNING')
    this.activated = true
    // No upstream ping exists. This explicitly reports process liveness, not model health.
    this.heartbeat = setInterval(() => {
      if (!this.closed && !this.stopping) this.dispatch(() => this.request.onHeartbeat(new Date().toISOString()))
    }, this.options.heartbeatIntervalMs)
  }

  stop(_reason: string): Promise<void> {
    return this.stopTask ??= this.performStop()
  }

  private async performStop(): Promise<void> {
    this.stopping = true
    clearInterval(this.heartbeat)
    if (this.closed) return
    this.signal('SIGTERM')
    const timer = setTimeout(() => this.signal('SIGKILL'), this.options.stopTimeoutMs)
    try { await this.exited } finally { clearTimeout(timer) }
  }

  private signal(signal: NodeJS.Signals): void {
    if (this.closed || !this.child.pid) return
    try {
      if (process.platform === 'win32') this.child.kill(signal)
      else process.kill(-this.child.pid, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }

  private receive(chunk: string): void {
    this.buffer += chunk
    if (Buffer.byteLength(this.buffer) > 1024 * 1024) {
      this.rejectPending('HARNESS_FRAME_TOO_LARGE')
      if (!this.stopping && this.activated) this.dispatch(() => this.request.onExit({ at: new Date().toISOString(), reason: 'HARNESS_FRAME_TOO_LARGE' }))
      void this.stop('oversized frame').catch(this.options.onFault)
      return
    }
    let end: number
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end + 1)
      let message: Record<string, unknown>
      try { message = JSON.parse(line) } catch { continue }
      if (!message || message.jsonrpc !== '2.0' || typeof message.id !== 'number' || 'method' in message) continue
      const pending = this.pending.get(message.id)
      if (!pending) continue
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if ('error' in message) pending.reject(new Error('HARNESS_RPC_REJECTED'))
      else if ('result' in message) pending.resolve(message.result)
      else pending.reject(new Error('HARNESS_RPC_INVALID'))
    }
  }

  private rejectPending(reason: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
    this.pending.clear()
  }

  private dispatch(callback: () => void | Promise<void>): void {
    void Promise.resolve().then(callback).catch(this.options.onFault)
  }
}

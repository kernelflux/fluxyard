import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import type { HarnessLaunchConfig } from '@fluxyard/runtime-node'
import { harnessReadyUrl } from './security.ts'

export class HarnessWebRuntime {
  private child?: ChildProcessWithoutNullStreams
  private exited?: Promise<void>
  private stopTask?: Promise<void>
  private stopping = false
  private exitObserved = false
  private readonly executable: string
  private readonly bootstrap: string
  private readonly extension: string | undefined
  private readonly onUnexpectedExit: () => void
  constructor(executable: string, bootstrap: string, onUnexpectedExit: () => void = () => {}, extension?: string) { this.extension = extension; this.executable = executable; this.bootstrap = bootstrap; this.onUnexpectedExit = onUnexpectedExit }

  async start(config: HarnessLaunchConfig): Promise<{ url: string; port: number }> {
    const server = createServer()
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const port = (server.address() as { port: number }).port
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    const patch = join(config.homeDirectory, 'fluxyard-consumer.patch.json')
    if (this.extension) await mkdir(config.homeDirectory, { recursive: true, mode: 0o700 })
    if (this.extension) await writeFile(patch, JSON.stringify([{ id: 'ui-settings-models', config: { credentialOnboarding: false } }, { insert: [{ id: 'fluxyard-consumer', name: pathToFileURL(this.extension).href }] }]), { mode: 0o600 })
    const extra = this.extension ? ['--patch', patch] : []
    const child = this.child = spawn(this.executable, ['--expose-internals', this.bootstrap, config.cliEntry, '--profile', 'web', ...extra, '--no-open', '--host', '127.0.0.1', '--port', String(port)], {
      cwd: config.workingDirectory, detached: process.platform !== 'win32', windowsHide: true, stdio: 'pipe',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: config.homeDirectory, DSH_TELEMETRY_MODE: 'DISABLED' },
    })
    child.stdin.end()
    this.exited = new Promise(resolve => {
      const finish = () => {
        if (this.exitObserved) return
        this.exitObserved = true; this.killGroup(); resolve()
        if (!this.stopping) this.onUnexpectedExit()
      }
      child.once('exit', finish)
      child.once('error', finish)
    })
    let buffer = ''
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail(), 30_000)
        const cleanup = () => { clearTimeout(timer); child.stdout.off('data', output); child.stderr.off('data', output); child.off('exit', fail); child.off('error', fail) }
        const fail = () => { cleanup(); reject(new Error('HARNESS_WEB_START_FAILED')) }
        const output = (chunk: Buffer) => {
          buffer = (buffer + chunk.toString('utf8')).slice(-32_768)
          const url = harnessReadyUrl(buffer, port)
          if (url) { cleanup(); resolve({ url, port }) }
        }
        child.stdout.on('data', output)
        child.stderr.on('data', output)
        child.once('exit', fail)
        child.once('error', fail)
      })
    } catch {
      await this.stop()
      throw new Error('HARNESS_WEB_START_FAILED')
    } finally {
      child.stdout.resume(); child.stderr.resume()
    }
  }

  stop(): Promise<void> { return this.stopTask ??= this.performStop() }
  private async performStop(): Promise<void> {
    this.stopping = true
    if (!this.child || this.exitObserved) return
    this.child.kill('SIGTERM')
    const timer = setTimeout(() => this.killGroup(), 6_000)
    try { await this.exited } finally { clearTimeout(timer) }
  }
  get running(): boolean { return Boolean(this.child) && !this.exitObserved && !this.stopping }
  private killGroup(): void {
    if (!this.child?.pid) return
    try {
      if (process.platform === 'win32') this.child.kill('SIGKILL')
      else process.kill(-this.child.pid, 'SIGKILL')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
  }
}

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DesktopService } from '../src/service.ts'
const bootstrap = fileURLToPath(new URL('../src/harness-bootstrap.mjs', import.meta.url))
describe('desktop runtime operations', () => {
  it('persists configuration, enforces one active runtime and restores stopped generations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluxyard-desktop-service-'))
    let service: DesktopService | undefined
    try {
      const installed = join(directory, 'installation')
      const pkg = join(installed, 'node_modules/@deepseek-ai/dsh')
      await mkdir(join(pkg, 'lib'), { recursive: true })
      await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.0-rc.2', type: 'module' }))
      await writeFile(join(pkg, 'lib/bin.js'), `import { createInterface } from 'node:readline'; export async function runCli() { createInterface({ input: process.stdin }).on('line', line => { const req = JSON.parse(line); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } } }) + '\\n'); }); }`)
      service = await DesktopService.open(join(directory, 'data'), process.execPath, bootstrap)
      await service.chooseInstallation(installed)
      await service.start()
      expect((await service.overview()).profiles[0]).toMatchObject({ status: 'healthy', generation: 1 })
      await expect(service.chooseWorkspace(directory)).rejects.toThrow('DESKTOP_RUNTIME_BUSY')
      await expect(service.start()).rejects.toThrow('DESKTOP_RUNTIME_BUSY')
      await service.stop()
      const reopened = await DesktopService.open(join(directory, 'data'), process.execPath, bootstrap)
      expect((await reopened.overview()).installation).toBe(installed)
      expect((await reopened.overview()).profiles[0]).toMatchObject({ status: 'stopped', generation: 1 })
      expect((await reopened.overview()).inventory).toEqual([])
    } finally { await service?.stop(); await rm(directory, { recursive: true, force: true }) }
  })
  it('does not couple personal workbench readiness to enterprise ledger health', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluxyard-personal-ledger-'))
    try {
      await writeFile(join(directory, 'control-plane.json'), '{corrupt')
      const service = await DesktopService.open(directory, process.execPath, bootstrap)
      expect(service.runtimeOverview()).toMatchObject({ webState: 'stopped', workspace: join(directory, 'workspace') })
      await expect(service.overview()).rejects.toThrow()
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('preserves corrupt settings instead of silently overwriting them', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'fluxyard-settings-'))
    try {
      await writeFile(join(directory, 'desktop-settings.json'), '{corrupt')
      await expect(DesktopService.open(directory, process.execPath, bootstrap)).rejects.toThrow()
      expect(await readFile(join(directory, 'desktop-settings.json'), 'utf8')).toBe('{corrupt')
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})

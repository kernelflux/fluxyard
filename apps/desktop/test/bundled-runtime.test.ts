import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { describe, it, expect } from 'vitest'
import { bundledRuntime } from '../src/bundled-runtime.ts'
import { DesktopService } from '../src/service.ts'
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
describe('bundled runtime distribution', () => {
  it('accepts the pinned carrier and rejects changed resources and incompatible targets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fluxyard-bundle-'))
    try {
      const runtime = join(root, 'harness-runtime')
      await mkdir(join(runtime, 'node_modules/@deepseek-ai/dsh/lib'), { recursive: true })
      await writeFile(join(runtime, 'package-lock.json'), 'lock')
      await writeFile(join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'entry')
      await writeFile(join(runtime, 'harness-bootstrap.mjs'), 'bootstrap')
      await writeFile(join(runtime, 'runtime-manifest.json'), JSON.stringify({ schemaVersion: 1, package: '@deepseek-ai/dsh', version: '0.2.0-rc.2', electron: '43.0.0', platform: 'darwin', arch: 'arm64', lockSha256: hash('lock'), entrySha256: hash('entry'), bootstrapSha256: hash('bootstrap') }))
      const carrier = { electron: '43.0.0', platform: 'darwin', arch: 'arm64' }
      expect(await bundledRuntime(root, carrier)).toEqual({ installation: runtime, bootstrap: join(runtime, 'harness-bootstrap.mjs') })
      await expect(bundledRuntime(root, { ...carrier, electron: '43.1.0' })).rejects.toThrow('BUNDLED_RUNTIME_INVALID')
      await expect(bundledRuntime(root, { ...carrier, arch: 'x64' })).rejects.toThrow('BUNDLED_RUNTIME_INVALID')
      await writeFile(join(runtime, 'harness-bootstrap.mjs'), 'changed')
      await expect(bundledRuntime(root, carrier)).rejects.toThrow('BUNDLED_RUNTIME_INVALID')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  it('keeps bundled profile identity across application relocation and forbids replacement', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fluxyard-relocate-'))
    try {
      for (const name of ['before', 'after']) {
        const pkg = join(root, name, 'node_modules/@deepseek-ai/dsh')
        await mkdir(join(pkg, 'lib'), { recursive: true })
        await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.2.0-rc.2', type: 'module' }))
        await writeFile(join(pkg, 'lib/bin.js'), `import { createInterface } from 'node:readline'; export async function runCli() { createInterface({ input: process.stdin }).on('line', line => { const req = JSON.parse(line); process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } } }) + '\\n'); }); }`)
      }
      const service = await DesktopService.open(join(root, 'data'), process.execPath, fileURLToPath(new URL('../src/harness-bootstrap.mjs', import.meta.url)))
      await service.useBundledInstallation(join(root, 'before'))
      const first = await service.overview()
      await expect(service.chooseInstallation(join(root, 'after'))).rejects.toThrow('BUNDLED_RUNTIME_MANAGED')
      await service.chooseWorkspace(root)
      await service.start()
      await service.stop()
      const movedWorkspace = (await service.overview()).selectedProfileId
      expect(movedWorkspace).not.toBe(first.selectedProfileId)
      const reopened = await DesktopService.open(join(root, 'data'), process.execPath, fileURLToPath(new URL('../src/harness-bootstrap.mjs', import.meta.url)))
      await reopened.useBundledInstallation(join(root, 'after'))
      expect((await reopened.overview()).selectedProfileId).toBe(movedWorkspace)
      expect((await reopened.overview()).bundledRuntime).toBe(true)
      await reopened.start()
      expect((await reopened.overview()).profiles[0]).toMatchObject({ status: 'healthy', generation: 2 })
      await reopened.stop()
      expect((await reopened.config()).cliEntry).toContain('/after/node_modules/')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})

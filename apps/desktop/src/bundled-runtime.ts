import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
const digest = async (path: string): Promise<string> => createHash('sha256').update(await readFile(path)).digest('hex')
/** Verify the fixed carrier manifest before handing the bundled CLI to a subprocess. */
export async function bundledRuntime(resources: string, carrier: { electron: string; platform: string; arch: string }): Promise<{ installation: string; bootstrap: string }> {
  const installation = join(resources, 'harness-runtime')
  try {
    const manifest = JSON.parse(await readFile(join(installation, 'runtime-manifest.json'), 'utf8'))
    if (manifest.schemaVersion !== 1 || manifest.package !== '@deepseek-ai/dsh' || manifest.version !== '0.2.0-rc.2' || manifest.electron !== carrier.electron || manifest.platform !== carrier.platform || manifest.arch !== carrier.arch) throw new Error('invalid carrier')
    const bootstrap = join(installation, 'harness-bootstrap.mjs')
    const checks = await Promise.all([digest(join(installation, 'package-lock.json')), digest(join(installation, 'node_modules/@deepseek-ai/dsh/lib/bin.js')), digest(bootstrap)])
    if (checks[0] !== manifest.lockSha256 || checks[1] !== manifest.entrySha256 || checks[2] !== manifest.bootstrapSha256) throw new Error('invalid resource digest')
    return { installation, bootstrap }
  } catch { throw new Error('BUNDLED_RUNTIME_INVALID') }
}

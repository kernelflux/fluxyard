import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export interface PruneReport { filesRemoved: number; bytesRemoved: number; bytesBefore: number; bytesAfter: number; categories: Record<string, number> }
/** Remove build artifacts, never runtime JS/assets, package manifests or license notices. */
export async function pruneRuntime(directory: string, platform: string, arch: string): Promise<PruneReport> {
  const report: PruneReport = { filesRemoved: 0, bytesRemoved: 0, bytesBefore: 0, bytesAfter: 0, categories: {} }
  async function visit(path: string, parts: string[]): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const next = join(path, entry.name)
      const relative = [...parts, entry.name]
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) { await visit(next, relative); continue }
      if (!entry.isFile()) continue
      const bytes = (await stat(next)).size
      report.bytesBefore += bytes
      let reason: string | undefined
      const license = /license|licence|notice|copying|copyright|authors/i.test(entry.name)
      if (!license) {
        if (entry.name.endsWith('.map')) reason = 'source-maps'
        else if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.tsbuildinfo')) reason = 'type-and-build-metadata'
        // node-pty ships all native targets and Windows symbols in a single package.
        else if (relative[0] === 'node-pty' && relative[1] === 'prebuilds' && relative[2] !== `${platform}-${arch}`) reason = 'other-platform-pty'
        else if (relative[0] === 'node-pty' && relative[1] === 'third_party' && platform !== 'win32') reason = 'windows-pty-tools'
      }
      if (reason) {
        await unlink(next)
        report.filesRemoved += 1; report.bytesRemoved += bytes
        report.categories[reason] = (report.categories[reason] ?? 0) + bytes
      } else report.bytesAfter += bytes
    }
  }
  await visit(join(directory, 'node_modules'), [])
  return report
}

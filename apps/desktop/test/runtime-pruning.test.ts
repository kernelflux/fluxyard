import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { pruneRuntime } from '../src/runtime-pruning.ts'

describe('runtime distribution pruning', () => {
  it('removes build artifacts and foreign terminal binaries while preserving runtime and licenses', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fluxyard-prune-'))
    const removed = ['sdk/index.js.map', 'sdk/types.d.ts', 'sdk/build.tsbuildinfo', 'node-pty/prebuilds/win32-x64/conpty.pdb', 'node-pty/third_party/conpty/OpenConsole.exe']
    const kept = ['sdk/index.js', 'sdk/package.json', 'sdk/LICENSE', 'sdk/NOTICE.map', 'sdk/src/code.ts', 'node-pty/prebuilds/darwin-arm64/pty.node', 'node-pty/prebuilds/win32-x64/LICENSE', '@deepseek-ai/libreoffice-kit-darwin-arm64/bin/libreoffice-kit', 'voice/model.onnx']
    try {
      for (const name of [...removed, ...kept]) { const path = join(root, 'node_modules', name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, 'payload') }
      const outside = join(root, 'outside.map'); await writeFile(outside, 'untouched')
      await symlink(outside, join(root, 'node_modules/sdk/linked.map'))
      const result = await pruneRuntime(root, 'darwin', 'arm64')
      expect(result.filesRemoved).toBe(removed.length)
      expect(result.bytesBefore - result.bytesAfter).toBe(result.bytesRemoved)
      for (const name of removed) await expect(readFile(join(root, 'node_modules', name))).rejects.toThrow()
      for (const name of kept) expect(await readFile(join(root, 'node_modules', name), 'utf8')).toBe('payload')
      expect(await readFile(outside, 'utf8')).toBe('untouched')
      expect((await pruneRuntime(root, 'darwin', 'arm64')).filesRemoved).toBe(0)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})

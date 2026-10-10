import { patchDesktopShortcuts, patchDesktopWelcome } from './src/runtime-desktop-patch.ts'
import { pruneRuntime } from './src/runtime-pruning.ts'
import { packager } from '@electron/packager'
import { cp, mkdir, readFile, rm, writeFile, rename, stat, symlink, readdir, readlink, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('.', import.meta.url))
process.chdir(root)
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Packaging acceptance currently supports macOS ARM64 only')
await import('./build.mjs')
const staging = join(root, '.packaging')
const appDir = join(staging, 'app')
const runtime = join(staging, 'harness-runtime')
await rm(appDir, { recursive: true, force: true })
await mkdir(appDir, { recursive: true })
await mkdir(runtime, { recursive: true })
await cp('dist', join(appDir, 'dist'), { recursive: true })
await cp(join(root, '../../LICENSE'), join(appDir, 'LICENSE'))
await cp(join(root, '../../NOTICE'), join(appDir, 'NOTICE'))
await writeFile(join(appDir, 'THIRD-PARTY-NOTICES.txt'), 'Fluxyard includes Electron and @deepseek-ai/dsh with their transitive dependencies.\nElectron license notices are in this application Resources directory.\nHarness package licenses and manifests are preserved in Resources/harness-runtime/node_modules.\nSee package-lock.json there for resolved versions and registry integrity hashes.\n')
await writeFile(join(appDir, 'package.json'), JSON.stringify({ name: 'fluxyard-desktop', version: '0.4.5', private: true, main: 'dist/main.cjs', license: 'Apache-2.0' }))
for (const name of ['package.json', 'package-lock.json']) await cp(join(root, 'runtime', name), join(runtime, name))
// npm ci verifies registry integrity and installs the committed dependency graph.
await new Promise((resolve, reject) => {
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'], { cwd: runtime, stdio: 'inherit' })
  child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Runtime installation failed (${code})`)))
})
await cp(join(root, 'dist/consumer-extension'), join(runtime, 'node_modules/@fluxyard/harness-extensions'), { recursive: true })
// Pinned 0.2.0-rc.2 assumes a privileged bridge when native layout is enabled.
// Retain browser shortcut storage/dispatch; expose no desktop API to agent UI.
const shortcutClient = join(runtime, 'node_modules/@deepseek-ai/dsh-client-shortcuts/lib/client.js')
await writeFile(shortcutClient, patchDesktopShortcuts(await readFile(shortcutClient, 'utf8')))
const modelsClient = join(runtime, 'node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js')
await writeFile(modelsClient, patchDesktopWelcome(await readFile(modelsClient, 'utf8')))
const pruning = await pruneRuntime(runtime, process.platform, process.arch)
console.log(JSON.stringify({ pruning }))
await cp('src/harness-bootstrap.mjs', join(runtime, 'harness-bootstrap.mjs'))
const sha256 = async path => createHash('sha256').update(await readFile(path)).digest('hex')
const manifest = { schemaVersion: 1, package: '@deepseek-ai/dsh', version: '0.2.0-rc.2', electron: '43.0.0', platform: process.platform, arch: process.arch, lockSha256: await sha256(join(runtime, 'package-lock.json')), entrySha256: await sha256(join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js')), bootstrapSha256: await sha256(join(runtime, 'harness-bootstrap.mjs')) }
await writeFile(join(runtime, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
// Stage only compiled app files; native runtime files live outside asar.
const result = await packager({ dir: appDir, out: join(root, 'release', '0.4.5'), name: 'Fluxyard', appBundleId: 'org.kernelflux.fluxyard.preview', appVersion: '0.4.5', electronVersion: '43.0.0', platform: process.platform, arch: process.arch, asar: true, prune: false, overwrite: true, download: { cacheRoot: join(staging, 'electron-cache') } })
await cp(runtime, join(result[0], 'Fluxyard.app/Contents/Resources/harness-runtime'), { recursive: true, verbatimSymlinks: true })
for (const name of ['LICENSE', 'LICENSES.chromium.html']) await cp(join(result[0], name), join(result[0], 'Fluxyard.app/Contents/Resources', `Electron-${name}`))
const executable = join(result[0], 'Fluxyard.app/Contents/MacOS/Fluxyard')
const imageSource = join(staging, 'dmg')
await rm(imageSource, { recursive: true, force: true })
await mkdir(imageSource, { recursive: true })
await symlink('/Applications', join(imageSource, 'Applications'))
await cp(join(result[0], 'Fluxyard.app'), join(imageSource, 'Fluxyard.app'), { recursive: true, verbatimSymlinks: true })
// Every link inside the app must resolve within the copied bundle, never a build directory.
const bundleRoot = await realpath(join(imageSource, 'Fluxyard.app'))
async function verifyLinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      const target = await readlink(path)
      const resolved = await realpath(path)
      if (target.startsWith('/') || !resolved.startsWith(bundleRoot + '/')) throw new Error(`Nonportable bundle link: ${path}`)
    } else if (entry.isDirectory()) await verifyLinks(path)
  }
}
await verifyLinks(bundleRoot)
const image = join(root, 'release', 'Fluxyard-0.4.5-darwin-arm64.dmg')
async function imageCommand(args) {
  await new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/hdiutil', args, { stdio: 'inherit' })
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`DMG creation failed (${code})`)))
  })
}
// Writing directly into compressed APFS images leaves superseded UDIF chunks.
// Convert a completed HFS+ image once, then publish it atomically.
const writable = join(staging, 'Fluxyard-writable.dmg')
const compressed = join(staging, 'Fluxyard-compressed.dmg')
await rm(writable, { force: true }); await rm(compressed, { force: true })
await imageCommand(['create', '-volname', 'Fluxyard', '-srcfolder', imageSource, '-fs', 'HFS+', '-format', 'UDRW', writable])
await imageCommand(['convert', writable, '-format', 'UDZO', '-imagekey', 'zlib-level=9', '-o', compressed])
await rename(compressed, image)
await rm(writable, { force: true })
await writeFile(`${image}.sha256`, `${await sha256(image)}  Fluxyard-0.4.5-darwin-arm64.dmg\n`)
const imageBytes = (await stat(image)).size
await writeFile(join(root, 'release/size-report.json'), JSON.stringify({ runtime: manifest, pruning, imageBytes, filesystem: 'HFS+', compression: 'UDZO-zlib-9' }, null, 2) + '\n')
console.log(JSON.stringify({ ok: true, executable, image, imageBytes, developerSigned: false, runtime: manifest, pruning }))

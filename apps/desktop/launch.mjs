import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
await import('./build.mjs')
const env = { ...process.env }
env.FLUXYARD_DESKTOP_DATA ??= fileURLToPath(new URL('../../.fluxyard/desktop/', import.meta.url))
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(require('electron'), [fileURLToPath(new URL('.', import.meta.url)), ...process.argv.slice(2)], { env, stdio: 'inherit' })
child.on('error', () => { process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))

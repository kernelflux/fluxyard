// Trusted carrier entry: CLI remains an unmodified external npm installation.
import { pathToFileURL } from 'node:url'
const [entry, ...args] = process.argv.slice(2)
if (!entry) throw new Error('HARNESS_ENTRY_REQUIRED')
process.env.ELECTRON_RUN_AS_NODE = '1'
process.argv = [process.execPath, entry, ...args]
const cli = await import(pathToFileURL(entry).href)
if (typeof cli.runCli !== 'function') throw new Error('HARNESS_LAUNCHER_UNSUPPORTED')
await cli.runCli()

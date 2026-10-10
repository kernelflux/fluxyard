import { createInterface } from 'node:readline'
const mode = process.env.FLUXYARD_FIXTURE_MODE
if (process.argv.includes('--version')) { console.log('0.2.1-alpha.2'); process.exit(0) }
if (mode === 'ignore-term') process.on('SIGTERM', () => {})
if (mode === 'early-exit') process.exit(41)
if (mode === 'crash') setTimeout(() => process.exit(42), 150)
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line)
  if (mode === 'silent') return
  const response = mode === 'reject'
    ? { error: { code: -32603, message: 'secret-do-not-persist' } }
    : { result: { serverInfo: { name: mode === 'wrong' ? 'wrong' : 'deepseek-harness-sdk-runtime', version: '0.0.1' }, home: process.env.DSH_HOME } }
  const frame = JSON.stringify({ jsonrpc: '2.0', id: request.id, ...response }) + '\n'
  // Exercise fragmented messages and noisy stdout.
  process.stdout.write('startup diagnostic\n' + frame.slice(0, 20))
  setTimeout(() => process.stdout.write(frame.slice(20)), 5)
})

import { build } from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'
await mkdir('dist', { recursive: true })
await build({ entryPoints: ['src/main.ts'], outfile: 'dist/main.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node24' })
await build({ entryPoints: ['src/preload.ts'], outfile: 'dist/preload.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node24' })
await build({ entryPoints: ['src/workbench-preload.ts'], outfile: 'dist/workbench-preload.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node24' })
await build({ entryPoints: ['src/renderer.ts'], outfile: 'dist/renderer.js', bundle: true, platform: 'browser', target: 'chrome140' })
for (const name of ['index.html', 'style.css', 'harness-bootstrap.mjs']) await copyFile(`src/${name}`, `dist/${name}`)

await mkdir('dist/consumer-extension', { recursive: true })
await build({ entryPoints: ['../../packages/harness-extensions/src/host.ts'], outfile: 'dist/consumer-extension/index.mjs', bundle: true, platform: 'node', format: 'esm', packages: 'external', target: 'node24' })
await copyFile('../../packages/harness-extensions/client.js', 'dist/consumer-extension/client.js')
await copyFile('../../LICENSE', 'dist/consumer-extension/LICENSE')
await import('node:fs/promises').then(async ({ writeFile }) => writeFile('dist/consumer-extension/package.json', JSON.stringify({ name: '@fluxyard/harness-extensions', version: '0.1.0', type: 'module', main: 'index.mjs', exports: { '.': './index.mjs', './client': './client.js', './package.json': './package.json' }, dsh: { client: { inject: ['@deepseek-ai/dsh-client-ui-conversation'], platform: 'web' } }, license: 'Apache-2.0' })))

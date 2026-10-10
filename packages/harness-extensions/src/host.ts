import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { DraftStore } from './store.ts'
import { presentationContext, type PromptAssembly, type AssemblyContext } from './context.ts'
import { exportPptx } from './ppt.ts'
interface HostContext {
  on(event: 'system-prompt/assemble', callback: (assembly: PromptAssembly, context: AssemblyContext, next: () => Promise<PromptAssembly>) => Promise<PromptAssembly>): () => void
  connection: { requestRejection(req: IncomingMessage): number | undefined }
  sessionController: { inspect(id: string): Promise<{ meta: { id: string } }> }
  webServer: { register(route: { kind: 'exact'; path: string; handler(req: IncomingMessage, res: ServerResponse): Promise<void> }): () => void }
  effect(callback: () => (() => void)): void
}
export const inject = ['webServer', 'connection', 'sessionController', 'systemPrompt']
export function apply(ctx: HostContext): void {
  if (!process.env.DSH_HOME) throw new Error('Presentation profile home is missing')
  const store = new DraftStore(join(process.env.DSH_HOME, 'fluxyard-ppt'))
  ctx.effect(() => ctx.on('system-prompt/assemble', async (_assembly, context, next) => presentationContext(store, await next(), context, async id => {
    const session = await ctx.sessionController.inspect(id)
    if (session.meta.id !== id) throw new Error('Invalid session identity')
  })))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/fluxyard/ppt', handler: async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) { res.writeHead(rejection); res.end(); return }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return }
    if (req.headers.origin !== `http://${req.headers.host}`) { res.writeHead(403); res.end(); return }
    if (req.headers['content-type'] !== 'application/json') { res.writeHead(415); res.end(); return }
    try {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) { size += chunk.length; if (size > 64_000) { res.writeHead(413); res.end(); return }; chunks.push(Buffer.from(chunk)) }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { action?: string; sessionId?: string; draft?: unknown; revision?: number }
      if (typeof body.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.sessionId)) throw new Error('Invalid session identity')
      if (!['read', 'save', 'export'].includes(body.action ?? '')) throw new Error('Invalid action')
      const session = await ctx.sessionController.inspect(body.sessionId)
      if (session.meta.id !== body.sessionId) throw new Error('Invalid session identity')
      if (body.action === 'export') {
        const saved = await store.read(body.sessionId)
        if (!saved || saved.revision !== body.revision) throw new Error('Stale presentation revision')
        const data = await exportPptx(saved.draft)
        res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'Content-Disposition': 'attachment; filename="Fluxyard-presentation.pptx"' }); res.end(data); return
      }
      const value = body.action === 'read' ? await store.read(body.sessionId) : await store.save(body.sessionId, body.draft, body.revision!)
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value))
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      const conflict = message === 'Stale presentation revision'
      res.writeHead(conflict ? 409 : 400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: conflict ? '内容已更新，请关闭后重新打开。' : '无法处理演示稿，请检查内容或会话状态。' }))
    }
  } }))
}

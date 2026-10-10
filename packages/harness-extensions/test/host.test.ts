import { it, expect } from 'vitest'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/host.ts'
it('requires authenticated same-origin requests and real sessions before exporting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fluxyard-ppt-host-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = root
  let handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> = async () => {}
  apply({ on: () => () => {}, connection: { requestRejection: req => req.headers.cookie === 'test=1' ? undefined : 401 }, sessionController: { inspect: async id => { if (id !== 'existing') throw new Error('missing'); return { meta: { id } } } }, effect: fn => { fn() }, webServer: { register: route => { handler = route.handler; return () => {} } } })
  const server = createServer((req,res) => { void handler(req,res) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`
  const request = (body: object, headers: Record<string,string> = {}) => fetch(`${origin}/fluxyard/ppt`, { method:'POST', headers: { Cookie:'test=1', Origin:origin, 'Content-Type':'application/json', ...headers }, body:JSON.stringify(body) })
  try {
    expect((await request({ action:'read',sessionId:'existing' }, { Cookie:'' })).status).toBe(401)
    expect((await request({ action:'read',sessionId:'existing' }, { Origin:'https://outside.example' })).status).toBe(403)
    expect((await request({ action:'read',sessionId:'absent' })).status).toBe(400)
    const draft = { title:'Review',style:'minimal',enabled:false,slides:[{title:'Editable output',bullets:['User initiated']}] }
    expect((await request({ action:'save',sessionId:'existing',draft,revision:0 })).status).toBe(200)
    expect((await request({ action:'save',sessionId:'existing',draft,revision:0 })).status).toBe(409)
    const output = await request({ action:'export',sessionId:'existing',revision:1 })
    expect(output.status).toBe(200)
    expect(Buffer.from(await output.arrayBuffer()).subarray(0,2).toString()).toBe('PK')
    expect((await request({ action:'export',sessionId:'existing',revision:0 })).status).toBe(409)
  } finally {
    await new Promise<void>((resolve,reject) => server.close(error=>error?reject(error):resolve()))
    if(previous===undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME=previous
    await rm(root,{recursive:true,force:true})
  }
})

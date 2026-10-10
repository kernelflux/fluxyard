import { it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DraftStore } from '../src/store.ts'
import { presentationContext, type PromptAssembly } from '../src/context.ts'
it('uses saved session context only when explicitly enabled and escapes interpolation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fluxyard-ppt-context-'))
  try {
    const store = new DraftStore(root)
    const draft = { title:'{{provider}}',style:'business',enabled:true,slides:[{title:'User outline',bullets:['{{missing_variable}}']}] }
    await store.save('enabled',draft,0)
    await store.save('disabled',{...draft,enabled:false},0)
    const assembly: PromptAssembly = { sections: [{ name:'policy',text:'Existing permissions' }],contexts: [{ name:'sandbox',text:'Existing sandbox' }], tools:[{ name:'existing-tool' }],variables:{ provider:'original-provider' } }
    const validate = async (id:string) => { if (!['enabled','disabled','other'].includes(id)) throw new Error('missing') }
    expect(await presentationContext(store,assembly,{},validate)).toBe(assembly)
    expect(await presentationContext(store,assembly,{agent:{session:{id:'disabled'}}},validate)).toBe(assembly)
    expect(await presentationContext(store,assembly,{agent:{session:{id:'other'}}},validate)).toBe(assembly)
    const result=await presentationContext(store,assembly,{agent:{session:{id:'enabled'}}},validate)
    expect(result.sections).toBe(assembly.sections)
    expect(result.tools).toBe(assembly.tools)
    expect(result.variables).toBe(assembly.variables)
    expect(result.contexts[0]).toEqual(assembly.contexts[0])
    expect(result.contexts[1]!.text).not.toContain('{{')
    const json=result.contexts[1]!.text.split('Saved presentation data (JSON):\n')[1]!
    expect(JSON.parse(json).title).toBe('{{provider}}')
    await store.save('enabled',{...draft,enabled:false},1)
    expect(await presentationContext(store,assembly,{agent:{session:{id:'enabled'}}},validate)).toBe(assembly)
    await expect(presentationContext(store,assembly,{agent:{session:{id:'missing'}}},validate)).rejects.toThrow()
  } finally { await rm(root,{recursive:true,force:true}) }
})

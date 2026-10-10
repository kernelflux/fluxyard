import { describe, it, expect } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { DraftStore, exportPptx, validateDraft } from '../src/index.ts'
const draft = { title: '产品计划', style: 'business', enabled: true, slides: [{ title: '用户产品', bullets: ['会话里的 PPT', '独立企业应用'] }] }
describe('consumer presentation foundation', () => {
  it('exports editable slide text rather than a flattened image', async () => {
    const files = unzipSync(await exportPptx(draft))
    expect(files['[Content_Types].xml']).toBeDefined()
    const slide = strFromU8(files['ppt/slides/slide1.xml']!)
    expect(slide).toContain('用户产品')
    expect(slide).toContain('会话里的 PPT')
    expect(slide).toContain('<a:t>')
    expect(slide).not.toContain('<p:pic>')
  })
  it('rejects unbounded and malformed drafts', () => {
    expect(() => validateDraft({ ...draft, slides: Array(13).fill(draft.slides[0]) })).toThrow()
    expect(() => validateDraft({ ...draft, style: 'unknown' })).toThrow()
    expect(() => validateDraft({ ...draft, slides: [{ title: 'x', bullets: ['x'.repeat(501)] }] })).toThrow()
  })
  it('isolates sessions, rejects stale concurrent writes and preserves corrupt state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fluxyard-ppt-'))
    try {
      const store = new DraftStore(root)
      const writes = await Promise.allSettled([store.save('session-a', draft, 0), store.save('session-a', draft, 0)])
      expect(writes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(await new DraftStore(root).read('session-a')).toMatchObject({ revision: 1 })
      expect(await store.read('session-b')).toBeNull()
      await expect(store.save('../escape', draft, 0)).rejects.toThrow()
      await writeFile(join(root, 'session-b.json'), '{broken')
      await expect(store.read('session-b')).rejects.toThrow()
      await expect(store.save('session-b', draft, 0)).rejects.toThrow()
      await expect(store.save('session-a', draft, 1)).resolves.toMatchObject({ revision: 2 })
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})

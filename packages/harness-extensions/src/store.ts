import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { validateDraft, type Draft } from './ppt.ts'
export interface SavedDraft { schema: 1; revision: number; draft: Draft }
export class DraftStore {
  private readonly root: string
  private queue: Promise<unknown> = Promise.resolve()
  constructor(root: string) { this.root = root }
  private path(sessionId: string): string {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) throw new Error('Invalid session identity')
    return join(this.root, `${sessionId}.json`)
  }
  async read(sessionId: string): Promise<SavedDraft | null> {
    const path = this.path(sessionId)
    let data: string
    try { data = await readFile(path, 'utf8') } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    const value = JSON.parse(data) as SavedDraft
    if (value.schema !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1) throw new Error('Corrupt presentation state')
    return { schema: 1, revision: value.revision, draft: validateDraft(value.draft) }
  }
  save(sessionId: string, input: unknown, expectedRevision: number): Promise<SavedDraft> {
    const operation = this.queue.then(async () => {
      const path = this.path(sessionId)
      const draft = validateDraft(input)
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid revision')
      const previous = await this.read(sessionId)
      if ((previous?.revision ?? 0) !== expectedRevision) throw new Error('Stale presentation revision')
      const value: SavedDraft = { schema: 1, revision: expectedRevision + 1, draft }
      await mkdir(this.root, { recursive: true })
      const temporary = `${path}.${randomUUID()}.tmp`
      try { await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 }); await rename(temporary, path) }
      finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
      return value
    })
    this.queue = operation.catch(() => {})
    return operation
  }
}

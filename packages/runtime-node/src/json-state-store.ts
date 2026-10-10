import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  RuntimeNodeInvariantError,
  type RuntimeNodeStateSnapshot,
  type RuntimeNodeStateStore,
} from './model.ts'

export class RuntimeNodeStoreError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options)
    this.code = code
    this.name = 'RuntimeNodeStoreError'
  }
}

export class JsonRuntimeNodeStateStore implements RuntimeNodeStateStore {
  readonly path: string

  constructor(path: string) {
    if (path.trim().length === 0) throw new RuntimeNodeStoreError('RUNTIME_STORE_PATH_INVALID', 'path is empty')
    this.path = path
  }

  async load(): Promise<RuntimeNodeStateSnapshot> {
    let source: string
    try {
      source = await readFile(this.path, 'utf8')
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return { schemaVersion: 1, profiles: [] }
      throw new RuntimeNodeStoreError('RUNTIME_STORE_READ_FAILED', `could not read ${this.path}`, { cause: error })
    }

    let value: unknown
    try {
      value = JSON.parse(source)
    } catch (error) {
      throw new RuntimeNodeStoreError('RUNTIME_STORE_JSON_INVALID', `${this.path} is not valid JSON`, { cause: error })
    }
    if (!isSnapshotShape(value)) {
      throw new RuntimeNodeStoreError(
        'RUNTIME_STORE_SCHEMA_INVALID',
        `${this.path} is not a supported Runtime Node snapshot`,
      )
    }
    return value
  }

  async save(snapshot: RuntimeNodeStateSnapshot): Promise<void> {
    if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.profiles)) {
      throw new RuntimeNodeStoreError('RUNTIME_STORE_SCHEMA_INVALID', 'refusing to save an invalid snapshot')
    }
    const temporaryPath = `${this.path}.tmp`
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    try {
      const file = await open(temporaryPath, 'w', 0o600)
      try {
        await file.writeFile(`${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
        await file.sync()
      } finally {
        await file.close()
      }
      await rename(temporaryPath, this.path)
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw new RuntimeNodeStoreError('RUNTIME_STORE_WRITE_FAILED', `could not write ${this.path}`, { cause: error })
    }
  }
}

function isSnapshotShape(value: unknown): value is RuntimeNodeStateSnapshot {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return candidate.schemaVersion === 1 && Array.isArray(candidate.profiles)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

export function explainRuntimeStateError(error: unknown): string {
  if (error instanceof RuntimeNodeInvariantError || error instanceof RuntimeNodeStoreError) return error.message
  return String(error)
}

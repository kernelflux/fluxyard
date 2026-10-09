import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AgentControlPlane, type ControlPlaneSnapshot } from '@fluxyard/core'

export class JsonStoreError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(`${code}: ${message}`, options)
    this.code = code
    this.name = 'JsonStoreError'
  }
}

export class JsonControlPlaneStore {
  readonly path: string

  constructor(path: string) {
    if (path.trim().length === 0) throw new JsonStoreError('STORE_PATH_INVALID', 'path must be non-empty')
    this.path = path
  }

  async load(): Promise<AgentControlPlane> {
    let source: string
    try {
      source = await readFile(this.path, 'utf8')
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return new AgentControlPlane()
      throw new JsonStoreError('STORE_READ_FAILED', `could not read ${this.path}`, { cause: error })
    }

    let value: unknown
    try {
      value = JSON.parse(source)
    } catch (error) {
      throw new JsonStoreError('STORE_JSON_INVALID', `${this.path} is not valid JSON`, { cause: error })
    }
    if (!isSnapshotShape(value)) {
      throw new JsonStoreError('STORE_SCHEMA_INVALID', `${this.path} is not a Fluxyard control-plane snapshot`)
    }

    try {
      return new AgentControlPlane(value)
    } catch (error) {
      throw new JsonStoreError('STORE_FACTS_INVALID', `${this.path} contains invalid control-plane facts`, {
        cause: error,
      })
    }
  }

  async save(plane: AgentControlPlane): Promise<void> {
    const directory = dirname(this.path)
    const temporaryPath = `${this.path}.tmp`
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const contents = `${JSON.stringify(plane.snapshot(), null, 2)}\n`

    try {
      const file = await open(temporaryPath, 'w', 0o600)
      try {
        await file.writeFile(contents, 'utf8')
        await file.sync()
      } finally {
        await file.close()
      }
      await rename(temporaryPath, this.path)
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw new JsonStoreError('STORE_WRITE_FAILED', `could not atomically write ${this.path}`, { cause: error })
    }
  }
}

function isSnapshotShape(value: unknown): value is ControlPlaneSnapshot {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return candidate.schemaVersion === 1
    && Array.isArray(candidate.workspaces)
    && Array.isArray(candidate.runtimeNodes)
    && Array.isArray(candidate.agents)
    && Array.isArray(candidate.usageEvents)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

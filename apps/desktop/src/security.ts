import { dirname, basename, join } from 'node:path'
export function electronNodeExecutable(executable: string, platform = process.platform): string {
  if (platform !== 'darwin') return executable
  const name = basename(executable)
  return join(dirname(dirname(executable)), 'Frameworks', `${name} Helper.app`, 'Contents', 'MacOS', `${name} Helper`)
}
export function isLocalHarnessUrl(candidate: string, port: number): boolean {
  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === String(port) && !url.username && !url.password
  } catch { return false }
}
/** Treat stdout as untrusted: accept only the port owned by this generation. */
export function harnessReadyUrl(output: string, port: number): string | undefined {
  const candidate = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)/.exec(output)?.[1]
  return candidate && isLocalHarnessUrl(candidate, port) ? candidate : undefined
}
export function safeDesktopError(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  const known = ['BUNDLED_RUNTIME_INVALID', 'BUNDLED_RUNTIME_MANAGED', 'HARNESS_START_FAILED', 'HARNESS_NOT_INSTALLED', 'HARNESS_VERSION_INVALID', 'HARNESS_WEB_START_FAILED', 'RUNTIME_START_NOT_ALLOWED', 'RUNTIME_TRANSITION_INVALID', 'RUNTIME_PROCESS_NOT_FOUND', 'DESKTOP_RUNTIME_BUSY', 'HARNESS_PROFILE_REQUIRED', 'DESKTOP_SETTINGS_INVALID']
  return known.find(code => message.startsWith(code)) ?? 'DESKTOP_OPERATION_FAILED'
}

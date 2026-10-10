import { describe, expect, it } from 'vitest'
import { electronNodeExecutable, harnessReadyUrl, isLocalHarnessUrl, safeDesktopError } from '../src/security.ts'
describe('desktop authority boundaries', () => {
  it('restricts Harness navigation to its exact generation origin', () => {
    expect(isLocalHarnessUrl('http://127.0.0.1:3210/?token=test', 3210)).toBe(true)
    for (const url of ['http://127.0.0.1:3211/', 'https://127.0.0.1:3210/', 'http://localhost:3210/', 'http://127.0.0.1:3210.evil.test/', 'http://user:secret@127.0.0.1:3210/', 'file:///etc/passwd', 'javascript:alert(1)']) expect(isLocalHarnessUrl(url, 3210)).toBe(false)
    expect(harnessReadyUrl('dsh web: http://127.0.0.1:3211/?token=wrong', 3210)).toBeUndefined()
  })
  it('chooses the bundled Helper on macOS without referencing a standalone Node', () => {
    expect(electronNodeExecutable('/Applications/Fluxyard.app/Contents/MacOS/Fluxyard', 'darwin')).toBe('/Applications/Fluxyard.app/Contents/Frameworks/Fluxyard Helper.app/Contents/MacOS/Fluxyard Helper')
    expect(electronNodeExecutable('/opt/Fluxyard', 'linux')).toBe('/opt/Fluxyard')
  })
  it('does not send arbitrary error details or secret-bearing messages to the renderer', () => {
    expect(safeDesktopError(new Error('provider failure: sk-secret'))).toBe('DESKTOP_OPERATION_FAILED')
    expect(safeDesktopError(new Error('HARNESS_START_FAILED: sk-secret'))).toBe('HARNESS_START_FAILED')
  })
})

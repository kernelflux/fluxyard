import { describe, expect, it } from 'vitest'
import { patchDesktopShortcuts } from '../src/runtime-desktop-patch.ts'
describe('native layout with browser shortcut adapter', () => {
  it('keeps web shortcut routing opt-in and repeatable without providing a privileged bridge', () => {
    const original = 'runtime: desktop === void 0 ? "web" : "desktop",'
    const patched = patchDesktopShortcuts(original)
    expect(patched).toContain('dataset.dshDesktopWebShortcuts === "true"')
    expect(patchDesktopShortcuts(patched)).toBe(patched)
  })
  it('fails packaging when the pinned upstream integration point changes or is ambiguous', () => {
    expect(() => patchDesktopShortcuts('new upstream format')).toThrow('HARNESS_DESKTOP_PATCH_INCOMPATIBLE')
    expect(() => patchDesktopShortcuts('runtime: desktop === void 0 ? "web" : "desktop",'.repeat(2))).toThrow('HARNESS_DESKTOP_PATCH_INCOMPATIBLE')
  })
})

import { patchDesktopWelcome } from '../src/runtime-desktop-patch.ts'
it('skips only the consumer preview notice without inventing a desktop bridge', () => {
  const source = 'if (!("dshDesktop" in globalThis)) ctx.slots.inject("settings.onboarding", () => notice);'
  const patched = patchDesktopWelcome(source)
  expect(patched).toContain('credentialOnboarding !== false')
  expect(patchDesktopWelcome(patched)).toBe(patched)
  expect(() => patchDesktopWelcome('unknown upstream source')).toThrow('HARNESS_DESKTOP_PATCH_INCOMPATIBLE')
})

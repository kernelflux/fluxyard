/** Keep upstream native layout separate from its optional privileged keyboard bridge. */
export function patchDesktopShortcuts(source: string): string {
  const before = 'runtime: desktop === void 0 ? "web" : "desktop",'
  const after = 'runtime: desktop === void 0 || document.documentElement.dataset.dshDesktopWebShortcuts === "true" ? "web" : "desktop",'
  if (source.includes(after)) return source
  if (source.split(before).length !== 2) throw new Error('HARNESS_DESKTOP_PATCH_INCOMPATIBLE')
  return source.replace(before, after)
}

/** Desktop consumer opens directly; the upstream preview notice remains in Web. */
export function patchDesktopWelcome(source: string): string {
  const before = 'if (!("dshDesktop" in globalThis)) ctx.slots.inject("settings.onboarding",'
  const after = 'if (!("dshDesktop" in globalThis) && globalThis[ONBOARDING_CONFIG_GLOBAL]?.credentialOnboarding !== false) ctx.slots.inject("settings.onboarding",'
  if (source.includes(after)) return source
  if (source.split(before).length !== 2) throw new Error('HARNESS_DESKTOP_PATCH_INCOMPATIBLE')
  return source.replace(before, after)
}

const ICON_PREFIX = 'ri-'
const ICON_VARIANTS = ['line', 'fill'] as const

/**
 * Retains explicit action/status variants independently of the symbol's base name.
 */
export function getIconVariant(name: string): typeof ICON_VARIANTS[number] | undefined {
  return ICON_VARIANTS.find((variant) => name.endsWith(`-${variant}`))
}

/**
 * Normalizes legacy wire names without merging distinct original symbols.
 */
export function resolveIconName(name: string): string {
  let resolved = name.startsWith(ICON_PREFIX) ? name.slice(ICON_PREFIX.length) : name
  const suffix = getIconVariant(resolved)
  if (suffix) {
    resolved = resolved.slice(0, -(suffix.length + 1))
  }

  return resolved
}

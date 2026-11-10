export enum LogoMaskMode {
  Alpha = 'alpha',
  InverseLuminance = 'inverse-luminance'
}

export interface MaskedPackageLogo {
  url: string
  mode: LogoMaskMode
}

/**
 * Accepts explicit mask modes without allowing unknown artwork modes to render
 * colorful logos in monochrome activity rows. URL policy belongs to the renderer.
 */
export function readMaskedPackageLogo(value: unknown): MaskedPackageLogo | undefined {
  if (!value || typeof value !== 'object' || !('url' in value) ||
      typeof value.url !== 'string' || !('mode' in value) ||
      value.mode !== LogoMaskMode.Alpha && value.mode !== LogoMaskMode.InverseLuminance) {
    return undefined
  }

  return { url: value.url, mode: value.mode }
}

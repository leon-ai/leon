import type { langs } from '@@/core/langs.json'

/**
 * Contain common/shared types that are universal across the project
 * and cannot be placed in the respective core chunks
 */

/**
 * Language
 */

/**
 * ISO 639-1 (Language codes) - ISO 3166-1 (Country Codes)
 * @see https://www.iso.org/iso-639-language-codes.html
 * @see https://www.iso.org/iso-3166-country-codes.html
 */

type Languages = typeof langs
export type LongLanguageCode = keyof Languages
type Language = Languages[LongLanguageCode]
export type ShortLanguageCode = Language['short']

/**
 * System
 */

export enum OSTypes {
  Windows = 'windows',
  MacOS = 'macos',
  Linux = 'linux',
  Unknown = 'unknown'
}
export enum CPUArchitectures {
  X64 = 'x64',
  ARM64 = 'arm64'
}

import { langs } from '@@/core/langs.json'

export type Languages = typeof langs

/**
 * ISO 639-1 (Language codes) - ISO 3166-1 (Country Codes)
 * @see https://www.iso.org/iso-639-language-codes.html
 * @see https://www.iso.org/iso-3166-country-codes.html
 */
export type LongLanguageCode = keyof Languages

export type Language = Languages[LongLanguageCode]

export type ShortLanguageCode = Language['short']

export function getShortLanguages(): ShortLanguageCode[] {
  const longLanguages = Object.keys(langs) as LongLanguageCode[]
  return longLanguages.map((lang) => {
    return langs[lang].short
  })
}

export function getLongLanguageCode(
  shortLanguage: ShortLanguageCode
): LongLanguageCode | null {
  for (const longLanguage in langs) {
    const longLanguageType = longLanguage as LongLanguageCode
    const lang = langs[longLanguageType]
    if (lang.short === shortLanguage) {
      return longLanguageType
    }
  }
  return null
}

export function getShortLanguageCode(
  longLanguage: LongLanguageCode
): ShortLanguageCode {
  return langs[longLanguage].short
}

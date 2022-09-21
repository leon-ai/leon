import { langs } from '@@/core/langs.json'

/**
 * ISO 639-1 (Language codes) - ISO 3166-1 (Country Codes)
 * @see https://www.iso.org/iso-639-language-codes.html
 * @see https://www.iso.org/iso-3166-country-codes.html
 */

type Languages = typeof langs
export type LongLanguageCode = keyof Languages
type Language = Languages[LongLanguageCode]
export type ShortLanguageCode = Language['short']

class Lang {
  private static instance: Lang

  private constructor() {
    // Singleton
  }

  public static getInstance() {
    if (Lang.instance == null) {
      Lang.instance = new Lang()
    }

    return Lang.instance
  }

  /**
   * Get short language codes
   * @example getShortLanguages() // ["en", "fr"]
   */
  public getShortLanguages(): ShortLanguageCode[] {
    const longLanguages = Object.keys(langs) as LongLanguageCode[]

    return longLanguages.map((lang) => langs[lang].short)
  }

  /**
   * Get long language code of the given short language code
   * @param shortLanguageCode The short language code of the language
   * @example getLongLanguageCode('en') // en-US
   */
  public getLongLanguageCode(shortLanguageCode: ShortLanguageCode) {
    for (const longLanguage in langs) {
      const longLanguageType = longLanguage as LongLanguageCode
      const lang = langs[longLanguageType]

      if (lang.short === shortLanguageCode) {
        return longLanguageType
      }
    }

    return null
  }

  /**
   * Get short language code of the given long language code
   * @param longLanguageCode The long language code of the language
   * @example getShortLanguageCode('en-US') // en
   */
  public getShortLanguageCode(
    longLanguageCode: LongLanguageCode
  ): ShortLanguageCode {
    return langs[longLanguageCode].short
  }
}

export const LANG = Lang.getInstance()

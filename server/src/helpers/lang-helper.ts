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

export class LangHelper {
  /**
   * Get short language codes
   * @example getShortCodes() // ["en", "fr"]
   */
  public static getShortCodes(): ShortLanguageCode[] {
    const longLanguages = Object.keys(langs) as LongLanguageCode[]

    return longLanguages.map((lang) => langs[lang].short)
  }

  /**
   * Get long language code of the given short language code
   * @param shortCode The short language code of the language
   * @example getLongCode('en') // en-US
   */
  public static getLongCode(
    shortCode: ShortLanguageCode
  ): LongLanguageCode | null {
    for (const longLanguage in langs) {
      const longLanguageType = longLanguage as LongLanguageCode
      const lang = langs[longLanguageType]

      if (lang.short === shortCode) {
        return longLanguageType
      }
    }

    return null
  }

  /**
   * Get short language code of the given long language code
   * @param longCode The long language code of the language
   * @example getShortCode('en-US') // en
   */
  public static getShortCode(longCode: LongLanguageCode): ShortLanguageCode {
    return langs[longCode].short
  }
}

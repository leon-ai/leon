class StringHelper {
  private static instance: StringHelper

  constructor() {
    if (StringHelper.instance == null) {
      StringHelper.instance = this
    }
  }

  /**
   * Parse, map (with object) and replace value(s) in a string
   * @param toReplace The string containing the placeholders to replace
   * @param obj The object containing the value(s) to replace with
   * @example findAndMap('Hello %name%!', { '%name%': 'Louis' }) // Hello Louis!
   */
  public findAndMap(toReplace: string, obj: Record<string, unknown>) {
    return toReplace.replace(
      new RegExp(Object.keys(obj).join('|'), 'gi'),
      (matched) => obj[matched] as string
    )
  }

  /**
   * Set first letter as uppercase
   * @param str String to transform
   * @example ucFirst('hello world') // Hello world
   */
  public ucFirst(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }

  /**
   * Transform snake_case string to PascalCase
   * @param str String to transform
   * @example snakeToPascalCase('hello_world') // HelloWorld
   */
  public snakeToPascalCase(str: string) {
    return str
      .split('_')
      .map((chunk) => this.ucFirst(chunk))
      .join('')
  }

  /**
   * Random string
   * @param length Length of the string
   * @example random(6) // 4f3a2b
   */
  public random(length: number) {
    return Math.random().toString(36).slice(-length)
  }

  /**
   * Remove accents
   * @param str String to remove accents
   * @example removeAccents('éèà') // eea
   */
  public removeAccents(str: string) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  }

  /**
   * Remove punctuation at the end of the string
   * @param str String to remove punctuation
   * @example removeEndPunctuation('Hello world!') // Hello world
   */
  public removeEndPunctuation(str: string) {
    const punctuations = ['.', ';', ':', '?', '!']
    const lastChar = str.charAt(str.length - 1)

    if (punctuations.includes(lastChar)) {
      return str.slice(0, -1)
    }

    return str
  }
}

export const STRING = new StringHelper()

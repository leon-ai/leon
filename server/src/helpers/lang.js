import { langs } from '@@/core/langs.json'

const lang = {}

lang.getShortLangs = () => Object.keys(langs).map((lang) => langs[lang].short)

lang.getLongCode = (shortLang) => {
  const langsArr = Object.keys(langs)

  for (let i = 0; i < langsArr.length; i += 1) {
    const { short } = langs[langsArr[i]]

    if (short === shortLang) {
      return langsArr[i]
    }
  }

  return null
}

lang.getShortCode = (longLang) => langs[longLang].short

export default lang

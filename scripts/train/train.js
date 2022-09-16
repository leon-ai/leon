import { containerBootstrap } from '@nlpjs/core-loader'
import { Nlp } from '@nlpjs/nlp'
import { LangAll } from '@nlpjs/lang-all'
import dotenv from 'dotenv'

import { log } from '@/helpers/log'
import { getShortLanguages } from '@/helpers/lang'
import trainGlobalResolvers from './train-resolvers-model/train-global-resolvers'
import trainSkillsResolvers from './train-resolvers-model/train-skills-resolvers'
import trainGlobalEntities from './train-main-model/train-global-entities'
import trainSkillsActions from './train-main-model/train-skills-actions'

dotenv.config()

/**
 * Training utterance samples script
 *
 * npm run train [en or fr]
 */
export default () =>
  new Promise(async (resolve, reject) => {
    const globalResolversModelFileName =
      'core/data/models/leon-global-resolvers-model.nlp'
    const skillsResolversModelFileName =
      'core/data/models/leon-skills-resolvers-model.nlp'
    const mainModelFileName = 'core/data/models/leon-main-model.nlp'

    try {
      /**
       * Global resolvers NLP model configuration
       */
      const globalResolversContainer = await containerBootstrap()

      globalResolversContainer.use(Nlp)
      globalResolversContainer.use(LangAll)

      const globalResolversNlp = globalResolversContainer.get('nlp')
      const globalResolversNluManager =
        globalResolversContainer.get('nlu-manager')

      globalResolversNluManager.settings.log = false
      globalResolversNluManager.settings.trainByDomain = false
      globalResolversNlp.settings.modelFileName = globalResolversModelFileName
      globalResolversNlp.settings.threshold = 0.8

      /**
       * Skills resolvers NLP model configuration
       */
      const skillsResolversContainer = await containerBootstrap()

      skillsResolversContainer.use(Nlp)
      skillsResolversContainer.use(LangAll)

      const skillsResolversNlp = skillsResolversContainer.get('nlp')
      const skillsResolversNluManager =
        skillsResolversContainer.get('nlu-manager')

      skillsResolversNluManager.settings.log = false
      skillsResolversNluManager.settings.trainByDomain = true
      skillsResolversNlp.settings.modelFileName = skillsResolversModelFileName
      skillsResolversNlp.settings.threshold = 0.8

      /**
       * Main NLP model configuration
       */
      const mainContainer = await containerBootstrap()

      mainContainer.use(Nlp)
      mainContainer.use(LangAll)

      const mainNlp = mainContainer.get('nlp')
      const mainNluManager = mainContainer.get('nlu-manager')
      // const mainSlotManager = container.get('SlotManager')

      mainNluManager.settings.log = false
      mainNluManager.settings.trainByDomain = true
      // mainSlotManager.settings.
      mainNlp.settings.forceNER = true // https://github.com/axa-group/nlp.js/blob/master/examples/17-ner-nlg/index.js
      // mainNlp.settings.nlu = { useNoneFeature: true }
      mainNlp.settings.calculateSentiment = true
      mainNlp.settings.modelFileName = mainModelFileName
      mainNlp.settings.threshold = 0.8

      /**
       * Training phases
       */
      const shortLangs = getShortLanguages()
      for (let h = 0; h < shortLangs.length; h += 1) {
        const lang = shortLangs[h]

        globalResolversNlp.addLanguage(lang)
        // eslint-disable-next-line no-await-in-loop
        await trainGlobalResolvers(lang, globalResolversNlp)

        skillsResolversNlp.addLanguage(lang)
        // eslint-disable-next-line no-await-in-loop
        await trainSkillsResolvers(lang, skillsResolversNlp)

        mainNlp.addLanguage(lang)
        // eslint-disable-next-line no-await-in-loop
        await trainGlobalEntities(lang, mainNlp)
        // eslint-disable-next-line no-await-in-loop
        await trainSkillsActions(lang, mainNlp)
      }

      try {
        await globalResolversNlp.train()

        log.success(
          `Global resolvers NLP model saved in ${globalResolversModelFileName}`
        )
        resolve()
      } catch (e) {
        log.error(`Failed to save global resolvers NLP model: ${e}`)
        reject()
      }

      try {
        await skillsResolversNlp.train()

        log.success(
          `Skills resolvers NLP model saved in ${skillsResolversModelFileName}`
        )
        resolve()
      } catch (e) {
        log.error(`Failed to save skills resolvers NLP model: ${e}`)
        reject()
      }

      try {
        await mainNlp.train()

        log.success(`Main NLP model saved in ${mainModelFileName}`)
        resolve()
      } catch (e) {
        log.error(`Failed to save main NLP model: ${e}`)
        reject()
      }
    } catch (e) {
      log.error(e.message)
      reject(e)
    }
  })

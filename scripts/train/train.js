import { containerBootstrap } from '@nlpjs/core-loader'
import { Nlp } from '@nlpjs/nlp'
import { LangAll } from '@nlpjs/lang-all'
import dotenv from 'dotenv'

import {
  MAIN_NLP_MODEL_PATH,
  SKILLS_RESOLVERS_NLP_MODEL_PATH,
  GLOBAL_RESOLVERS_NLP_MODEL_PATH
} from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import { LangHelper } from '@/helpers/lang-helper'

import trainGlobalResolvers from './train-resolvers-model/train-global-resolvers'
import trainSkillsResolvers from './train-resolvers-model/train-skills-resolvers'
import trainGlobalEntities from './train-main-model/train-global-entities'
import trainSkillsActions from './train-main-model/train-skills-actions'
import trainLLMActionsClassifier from './train-llm-actions-classifier'
import trainSkillRouterDuty from './train-skill-router-duty.js'

dotenv.config()

/**
 * Training utterance samples script
 *
 * npm run train [en or fr]
 */
export default () =>
  new Promise(async (resolve, reject) => {
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
      globalResolversNlp.settings.modelFileName =
        GLOBAL_RESOLVERS_NLP_MODEL_PATH
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
      skillsResolversNlp.settings.modelFileName =
        SKILLS_RESOLVERS_NLP_MODEL_PATH
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
      mainNlp.settings.modelFileName = MAIN_NLP_MODEL_PATH
      mainNlp.settings.threshold = 0.8

      /**
       * Training phases
       */
      const shortLangs = LangHelper.getShortCodes()
      for (let h = 0; h < shortLangs.length; h += 1) {
        const lang = shortLangs[h]

        globalResolversNlp.addLanguage(lang)
        await trainGlobalResolvers(lang, globalResolversNlp)

        skillsResolversNlp.addLanguage(lang)
        await trainSkillsResolvers(lang, skillsResolversNlp)

        mainNlp.addLanguage(lang)
        await trainGlobalEntities(lang, mainNlp)
        await trainSkillsActions(lang, mainNlp)
      }

      try {
        await globalResolversNlp.train()

        LogHelper.success(
          `Global resolvers NLP model saved in ${GLOBAL_RESOLVERS_NLP_MODEL_PATH}`
        )
        resolve()
      } catch (e) {
        LogHelper.error(`Failed to save global resolvers NLP model: ${e}`)
        reject()
      }

      try {
        await skillsResolversNlp.train()

        LogHelper.success(
          `Skills resolvers NLP model saved in ${SKILLS_RESOLVERS_NLP_MODEL_PATH}`
        )
        resolve()
      } catch (e) {
        LogHelper.error(`Failed to save skills resolvers NLP model: ${e}`)
        reject()
      }

      try {
        await mainNlp.train()

        LogHelper.success(`Main NLP model saved in ${MAIN_NLP_MODEL_PATH}`)
        resolve()
      } catch (e) {
        LogHelper.error(`Failed to save main NLP model: ${e}`)
        reject()
      }

      try {
        await trainLLMActionsClassifier()

        LogHelper.success('LLM actions classifier trained')
        resolve()
      } catch (e) {
        LogHelper.error(`Failed to train LLM actions classifier: ${e}`)
        reject()
      }

      try {
        await trainSkillRouterDuty()

        LogHelper.success('Skill router duty trained')
        resolve()
      } catch (e) {
        LogHelper.error(`Failed to train skill router duty: ${e}`)
        reject()
      }
    } catch (e) {
      LogHelper.error(e.message)
      reject(e)
    }
  })

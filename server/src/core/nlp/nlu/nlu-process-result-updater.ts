import type { NLUProcessResult } from '@/core/nlp/types'
import type {
  SkillLocaleConfigSchema,
  SkillSchema
} from '@/schemas/skill-schemas'
import { BRAIN, NLU, NER, MODEL_LOADER } from '@/core'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { LogHelper } from '@/helpers/log-helper'
import { SkillBridges } from '@/core/brain/types'

const SKILL_CONFIG_PROPS_TO_KEEP = ['name', 'bridge', 'version', 'flow']

export const DEFAULT_NLU_PROCESS_RESULT: NLUProcessResult = {
  // Skill name without the "_skill" prefix
  contextName: '',
  skillName: '',
  actionName: '',
  skillConfigPath: '',
  skillConfig: {
    name: '',
    bridge: SkillBridges.Python,
    version: '',
    flow: []
  },
  localeSkillConfig: {
    variables: {},
    widgetContents: {}
  },
  actionConfig: null,
  new: {
    utterance: '',
    actionArguments: {},
    entities: [],
    sentiment: {}
  },
  context: {
    utterances: [],
    actionArguments: [],
    entities: [],
    sentiments: [],
    data: {}
  }
}

export class NLUProcessResultUpdater {
  public static async update(
    newResult: Partial<NLUProcessResult>
  ): Promise<void> {
    /**
     * Utterance update dependencies, update:
     * The utterance, entities, sentiment(s)
     */
    if (newResult.new?.utterance && newResult.new.utterance !== '') {
      const newUtterance = newResult.new.utterance
      const {
        utterances: contextUtterances,
        entities: contextEntities,
        sentiments: contextSentiments
      } = NLU.nluProcessResult.context

      // Extract built-in entities from the utterance
      const newEntities = await NER.extractBuiltInEntities(
        BRAIN.lang,
        newUtterance
      )

      // Get sentiment analysis
      const { sentiment } =
        await MODEL_LOADER.mainNLPContainer.getSentiment(newUtterance)

      NLU.nluProcessResult = {
        ...NLU.nluProcessResult,
        new: {
          utterance: newUtterance,
          actionArguments: {},
          entities: newEntities,
          sentiment: {
            vote: sentiment.vote || 'neutral',
            score: sentiment.score || 0
          }
        },
        context: {
          ...NLU.nluProcessResult.context,
          utterances: [...contextUtterances, newUtterance],
          entities: [...contextEntities, ...newEntities],
          sentiments: [
            ...contextSentiments,
            {
              vote: sentiment.vote || 'neutral',
              score: sentiment.score || 0
            }
          ]
        }
      }

      return
    }

    /**
     * Skill name update dependencies, update:
     * The context name, skill name, skill config path
     */
    if (newResult.skillName && newResult.skillName !== '') {
      const newContextName = newResult.skillName.replace(/_skill$/, '')
      const isNewContext = newContextName !== NLU.nluProcessResult.contextName
      const skillNameDepProperties: {
        skillName: string
        skillConfigPath: string
        skillConfig: Partial<SkillSchema> | null
        localeSkillConfig: Partial<SkillLocaleConfigSchema> | null
      } = {
        skillName: newResult.skillName,
        skillConfigPath:
          SkillDomainHelper.getNewSkillConfigPath(newResult.skillName) || '',
        skillConfig: null,
        localeSkillConfig: null
      }
      const newSkillConfig = await SkillDomainHelper.getNewSkillConfig(
        newResult.skillName
      )

      if (newSkillConfig) {
        /**
         * Filter the skill config properties to keep only the ones we need
         * to not overload the NLU process result with unnecessary data
         */
        skillNameDepProperties.skillConfig = Object.keys(newSkillConfig)
          .filter((key) => SKILL_CONFIG_PROPS_TO_KEEP.includes(key))
          .reduce((obj, key) => {
            const typedKey = key as keyof SkillSchema
            const value = newSkillConfig[typedKey]

            if (value !== undefined) {
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-expect-error
              obj[typedKey] = value
            }

            return obj
          }, {} as Partial<SkillSchema>)

        // Get the skill locale config for the new skill name
        const newSkillLocaleConfig =
          (await SkillDomainHelper.getSkillLocaleConfig(
            BRAIN.lang,
            newResult.skillName
          )) as SkillLocaleConfigSchema
        skillNameDepProperties.localeSkillConfig = {
          variables: newSkillLocaleConfig.variables || {},
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          widgetContents: newSkillLocaleConfig.widget_contents || {}
        }
      }

      // New context detected, we need to reset and keep only the new data
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      NLU.nluProcessResult = isNewContext
        ? {
            ...DEFAULT_NLU_PROCESS_RESULT,
            contextName: newContextName,
            // Do not reset the new data
            new: NLU.nluProcessResult.new,
            // Only keep the new data in the context
            context: {
              utterances: [NLU.nluProcessResult.new.utterance],
              // Action arguments aren't processed yet at this stage, hence empty
              actionArguments: [],
              entities: NLU.nluProcessResult.new.entities,
              sentiments: [NLU.nluProcessResult.new.sentiment],
              // Preserve context data when switching skills/contexts
              data: NLU.nluProcessResult.context.data
            },
            ...skillNameDepProperties
          }
        : {
            ...NLU.nluProcessResult,
            ...skillNameDepProperties
          }

      return
    }

    /**
     * Action name update dependencies, update:
     * The action name, action config
     */
    if (newResult.actionName && newResult.actionName !== '') {
      const { skillName } = NLU.nluProcessResult
      const skillConfig = await SkillDomainHelper.getNewSkillConfig(skillName)
      const newActionConfig =
        skillConfig?.actions?.[newResult.actionName] || null
      const newSkillLocaleConfig =
        (await SkillDomainHelper.getSkillLocaleConfig(
          BRAIN.lang,
          skillName
        )) as SkillLocaleConfigSchema
      const newActionLocaleConfig =
        newSkillLocaleConfig['actions'][newResult.actionName]

      if (!newActionLocaleConfig) {
        LogHelper.title('NLU')
        LogHelper.error(
          `Action locale config not found for the "${newResult.actionName}" action of the "${skillName}" skill. Please verify the action name matches in the "${BRAIN.lang}.json" locale config`
        )
      }

      NLU.nluProcessResult = {
        ...NLU.nluProcessResult,
        actionName: newResult.actionName,
        actionConfig: newActionConfig
          ? {
              ...newActionConfig,
              ...newActionLocaleConfig
            }
          : newActionConfig
      }

      return
    }

    /**
     * Action arguments update dependencies, update:
     * The action arguments
     */
    if (newResult.new?.actionArguments) {
      const newActionArguments = newResult.new.actionArguments
      const contextActionArguments =
        NLU.nluProcessResult.context.actionArguments

      NLU.nluProcessResult = {
        ...NLU.nluProcessResult,
        new: {
          ...NLU.nluProcessResult.new,
          actionArguments: newActionArguments
        },
        context: {
          ...NLU.nluProcessResult.context,
          actionArguments: [
            ...contextActionArguments,
            { ...newActionArguments }
          ]
        }
      }

      return
    }

    /**
     * If there is no key that involves dependency update,
     * then update as is
     */
    NLU.nluProcessResult = {
      ...NLU.nluProcessResult,
      ...newResult,
      new: {
        ...NLU.nluProcessResult.new,
        ...newResult.new
      },
      context: {
        ...NLU.nluProcessResult.context,
        ...newResult.context
      }
    }
  }
}

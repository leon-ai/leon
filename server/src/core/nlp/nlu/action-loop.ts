import fs from 'node:fs'
import { join } from 'node:path'

import type { NLPUtterance } from '@/core/nlp/types'
import type { BrainProcessResult } from '@/core/brain/types'
import { BRAIN, MODEL_LOADER, NER, NLU } from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { DEFAULT_NLU_RESULT } from '@/core/nlp/nlu/nlu'

interface ResolveResolversResult {
  name: string
  value: string
}

export class ActionLoop {
  /**
   * Handle action loop logic before NLU processing
   */
  public static async handle(
    utterance: NLPUtterance
  ): Promise<Partial<BrainProcessResult> | null> {
    const { domain, intent } = NLU.conversation.activeContext
    const [skillName, actionName] = intent.split('.') as [string, string]
    const skillConfigPath = SkillDomainHelper.getSkillConfigPath(
      domain,
      skillName,
      BRAIN.lang
    )
    const newNLUResult = {
      ...DEFAULT_NLU_RESULT, // Reset entities, slots, etc.
      slots: NLU.conversation.activeContext.slots,
      utterance,
      newUtterance: utterance,
      skillConfigPath,
      classification: {
        domain,
        skill: skillName,
        action: actionName,
        confidence: 1
      }
    }
    const newNLUResultEntities = await NER.extractEntities(
      BRAIN.lang,
      skillConfigPath,
      newNLUResult
    )
    await NLU.setNLUResult({
      ...newNLUResult,
      entities: newNLUResultEntities
    })

    const { actions, resolvers } = await SkillDomainHelper.getSkillConfig(
      skillConfigPath,
      BRAIN.lang
    )
    const action = actions[NLU.nluResult.classification.action]
    if (action?.loop) {
      const { name: expectedItemName, type: expectedItemType } =
        action.loop.expected_item
      let hasMatchingUtterance = false
      let hasMatchingEntity = false
      let hasMatchingResolver = false

      if (expectedItemType === 'utterance') {
        hasMatchingUtterance = true
      } else if (expectedItemType === 'entity') {
        hasMatchingEntity =
          NLU.nluResult.entities.filter(
            ({ entity }) => expectedItemName === entity
          ).length > 0
      } else if (expectedItemType.indexOf('resolver') !== -1) {
        const nlpObjs = {
          global_resolver: MODEL_LOADER.globalResolversNLPContainer,
          skill_resolver: MODEL_LOADER.skillsResolversNLPContainer
        }
        const result = await nlpObjs[expectedItemType].process(utterance)
        const { intent } = result

        const resolveResolvers = async (
          resolver: string,
          intent: string
        ): Promise<[ResolveResolversResult]> => {
          const resolversPath = join(
            process.cwd(),
            'core',
            'data',
            BRAIN.lang,
            'global-resolvers'
          )
          // Load the skill resolver or the global resolver
          const resolvedIntents = !intent.includes('resolver.global')
            ? resolvers && resolvers[resolver]
            : JSON.parse(
                await fs.promises.readFile(
                  join(resolversPath, `${resolver}.json`),
                  'utf8'
                )
              )

          // E.g. resolver.global.denial -> denial
          intent = intent.substring(intent.lastIndexOf('.') + 1)

          return [
            {
              name: expectedItemName,
              value: resolvedIntents.intents[intent].value
            }
          ]
        }

        // Resolve resolver if global resolver or skill resolver has been found
        if (
          intent &&
          (intent.includes('resolver.global') ||
            intent.includes(`resolver.${skillName}`))
        ) {
          LogHelper.title('Action Loop')
          LogHelper.success('Resolvers resolved:')

          const resolvedResolvers = await resolveResolvers(
            expectedItemName,
            intent
          )
          await NLU.setNLUResult({
            ...NLU.nluResult,
            resolvers: resolvedResolvers
          })
          resolvedResolvers.forEach((resolver) =>
            LogHelper.success(`${intent}: ${JSON.stringify(resolver)}`)
          )
          hasMatchingResolver = NLU.nluResult.resolvers.length > 0
        }
      }

      // Ensure expected items are in the utterance, otherwise clean context and reprocess
      if (!hasMatchingEntity && !hasMatchingResolver && !hasMatchingUtterance) {
        LogHelper.title('Action Loop')
        LogHelper.info('Expected item not found in the utterance')
        // await BRAIN.talk(`${BRAIN.wernicke('random_context_out_of_topic')}.`)
        NLU.conversation.cleanActiveContext()
        await NLU.process(utterance)
        return null
      }

      // TODO: core rewrite
      return null
      /*try {
        const processedData = await BRAIN.execute(NLU.nluResult)
        // Reprocess with the original utterance that triggered the context at first
        if (processedData.core?.restart === true) {
          const { originalUtterance } = NLU.conversation.activeContext

          NLU.conversation.cleanActiveContext()

          if (originalUtterance !== null) {
            await NLU.process(originalUtterance)
          }

          return null
        }

        /!**
         * In case there is no next action to prepare anymore
         * and there is an explicit stop of the loop from the skill
         *!/
        if (
          !processedData.action?.next_action &&
          processedData.core?.isInActionLoop === false
        ) {
          NLU.conversation.cleanActiveContext()
          return null
        }

        // Break the action loop and prepare for the next action if necessary
        if (processedData.core?.isInActionLoop === false) {
          NLU.conversation.activeContext.isInActionLoop =
            !!processedData.action?.loop
          NLU.conversation.activeContext.actionName = processedData.action
            ?.next_action as string
          NLU.conversation.activeContext.intent = `${processedData.classification?.skill}.${processedData.action?.next_action}`
        }

        return processedData
      } catch (e) {
        LogHelper.title('Action Loop')
        LogHelper.warning(`Failed to execute action loop: ${e}`)

        return null
      }*/
    }

    return null
  }
}

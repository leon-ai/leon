import fs from 'node:fs'
import { join } from 'node:path'

import type { NLPUtterance } from '@/core/nlp/types'
import type { BrainProcessResult } from '@/core/brain/types'
import { BRAIN, MODEL_LOADER, NER, NLU } from '@/core'
import { LogHelper } from '@/helpers/log-helper'
import { DEFAULT_NLU_RESULT } from '@/core/nlp/nlu/nlu'

export class ActionLoop {
  /**
   * Handle action loop logic before NLU processing
   */
  public static async handle(
    utterance: NLPUtterance
  ): Promise<Partial<BrainProcessResult> | null> {
    const { domain, intent } = NLU.conversation.activeContext
    const [skillName, actionName] = intent.split('.')
    const skillConfigPath = join(
      process.cwd(),
      'skills',
      domain,
      skillName,
      `config/${BRAIN.lang}.json`
    )
    NLU.nluResult = {
      ...DEFAULT_NLU_RESULT, // Reset entities, slots, etc.
      slots: NLU.conversation.activeContext.slots,
      utterance,
      skillConfigPath,
      classification: {
        domain,
        skill: skillName,
        action: actionName,
        confidence: 1
      }
    }
    NLU.nluResult.entities = await NER.extractEntities(
      BRAIN.lang,
      skillConfigPath,
      NLU.nluResult
    )

    // TODO: type
    const { actions, resolvers } = JSON.parse(
      fs.readFileSync(skillConfigPath, 'utf8')
    )
    const action = actions[NLU.nluResult.classification.action]
    const { name: expectedItemName, type: expectedItemType } =
      action.loop.expected_item
    let hasMatchingEntity = false
    let hasMatchingResolver = false

    if (expectedItemType === 'entity') {
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

      const resolveResolvers = (resolver, intent) => {
        const resolversPath = join(
          process.cwd(),
          'core/data',
          BRAIN.lang,
          'global-resolvers'
        )
        // Load the skill resolver or the global resolver
        const resolvedIntents = !intent.includes('resolver.global')
          ? resolvers[resolver]
          : JSON.parse(fs.readFileSync(join(resolversPath, `${resolver}.json`)))

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
        LogHelper.title('NLU')
        LogHelper.success('Resolvers resolved:')
        NLU.nluResult.resolvers = resolveResolvers(expectedItemName, intent)
        NLU.nluResult.resolvers.forEach((resolver) =>
          LogHelper.success(`${intent}: ${JSON.stringify(resolver)}`)
        )
        hasMatchingResolver = NLU.nluResult.resolvers.length > 0
      }
    }

    // Ensure expected items are in the utterance, otherwise clean context and reprocess
    if (!hasMatchingEntity && !hasMatchingResolver) {
      BRAIN.talk(`${BRAIN.wernicke('random_context_out_of_topic')}.`)
      NLU.conversation.cleanActiveContext()
      await NLU.process(utterance)
      return null
    }

    try {
      const processedData = await BRAIN.execute(NLU.nluResult)
      // Reprocess with the original utterance that triggered the context at first
      if (processedData.core?.restart === true) {
        const { originalUtterance } = NLU.conversation.activeContext

        NLU.conversation.cleanActiveContext()
        await NLU.process(originalUtterance)
        return null
      }

      /**
       * In case there is no next action to prepare anymore
       * and there is an explicit stop of the loop from the skill
       */
      if (
        !processedData.action.next_action &&
        processedData.core?.isInActionLoop === false
      ) {
        NLU.conversation.cleanActiveContext()
        return null
      }

      // Break the action loop and prepare for the next action if necessary
      if (processedData.core?.isInActionLoop === false) {
        NLU.conversation.activeContext.isInActionLoop = !!processedData.action.loop
        NLU.conversation.activeContext.actionName = processedData.action.next_action
        NLU.conversation.activeContext.intent = `${processedData.classification.skill}.${processedData.action.next_action}`
      }

      return processedData
    } catch (e) {
      return null
    }
  }
}

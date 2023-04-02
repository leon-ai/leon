import { join } from 'node:path'

import type { NLPUtterance } from '@/core/nlp/types'
import type { BrainProcessResult } from '@/core/brain/types'
import { BRAIN, MODEL_LOADER, NER, NLU, SOCKET_SERVER } from '@/core'
import { DEFAULT_NLU_RESULT } from '@/core/nlp/nlu/nlu'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { DEFAULT_ACTIVE_CONTEXT } from '@/core/nlp/conversation'

export class SlotFilling {
  /**
   * Handle slot filling
   */
  public static async handle(
    utterance: NLPUtterance
  ): Promise<Partial<BrainProcessResult> | null> {
    const processedData = await this.fillSlot(utterance)

    /**
     * In case the slot filling has been interrupted. e.g. context change, etc.
     * Then reprocess with the new utterance
     */
    if (!processedData) {
      await NLU.process(utterance)
      return null
    }

    if (processedData && Object.keys(processedData).length > 0) {
      // Set new context with the next action if there is one
      if (processedData.action?.next_action) {
        NLU.conversation.activeContext = {
          ...DEFAULT_ACTIVE_CONTEXT,
          lang: BRAIN.lang,
          slots: processedData.slots || {},
          isInActionLoop: !!processedData.nextAction?.loop,
          originalUtterance: processedData.utterance ?? null,
          skillConfigPath: processedData.skillConfigPath || '',
          actionName: processedData.action.next_action,
          domain: processedData.classification?.domain || '',
          intent: `${processedData.classification?.skill}.${processedData.action.next_action}`,
          entities: []
        }
      }
    }

    return processedData
  }

  /**
   * Build NLU data result object based on slots
   * and ask for more entities if necessary
   */
  public static async fillSlot(
    utterance: NLPUtterance
  ): Promise<Partial<BrainProcessResult> | null> {
    if (!NLU.conversation.activeContext.nextAction) {
      return null
    }

    const { domain, intent } = NLU.conversation.activeContext
    const [skillName, actionName] = intent.split('.') as [string, string]
    const skillConfigPath = join(
      process.cwd(),
      'skills',
      domain,
      skillName,
      'config',
      BRAIN.lang + '.json'
    )

    NLU.nluResult = {
      ...DEFAULT_NLU_RESULT, // Reset entities, slots, etc.
      utterance,
      classification: {
        domain,
        skill: skillName,
        action: actionName,
        confidence: 1
      }
    }

    const entities = await NER.extractEntities(
      BRAIN.lang,
      skillConfigPath,
      NLU.nluResult
    )

    // Continue to loop for questions if a slot has been filled correctly
    let notFilledSlot = NLU.conversation.getNotFilledSlot()
    if (notFilledSlot && entities.length > 0) {
      const hasMatch = entities.some(
        ({ entity }) => entity === notFilledSlot?.expectedEntity
      )

      if (hasMatch) {
        NLU.conversation.setSlots(BRAIN.lang, entities)

        notFilledSlot = NLU.conversation.getNotFilledSlot()
        if (notFilledSlot) {
          BRAIN.talk(notFilledSlot.pickedQuestion)
          SOCKET_SERVER.socket.emit('is-typing', false)

          return {}
        }
      }
    }

    if (!NLU.conversation.areSlotsAllFilled()) {
      BRAIN.talk(`${BRAIN.wernicke('random_context_out_of_topic')}.`)
    } else {
      NLU.nluResult = {
        ...DEFAULT_NLU_RESULT, // Reset entities, slots, etc.
        // Assign slots only if there is a next action
        slots: NLU.conversation.activeContext.nextAction
          ? NLU.conversation.activeContext.slots
          : {},
        utterance: NLU.conversation.activeContext.originalUtterance ?? '',
        skillConfigPath,
        classification: {
          domain,
          skill: skillName,
          action: NLU.conversation.activeContext.nextAction,
          confidence: 1
        }
      }

      NLU.conversation.cleanActiveContext()

      return BRAIN.execute(NLU.nluResult)
    }

    NLU.conversation.cleanActiveContext()
    return null
  }

  /**
   * Decide what to do with slot filling.
   * 1. Activate context
   * 2. If the context is expecting slots, then loop over questions to slot fill
   * 3. Or go to the brain executor if all slots have been filled in one shot
   */
  public static async route(intent: string): Promise<boolean> {
    const slots =
      await MODEL_LOADER.mainNLPContainer.slotManager.getMandatorySlots(intent)
    const hasMandatorySlots = Object.keys(slots)?.length > 0

    if (hasMandatorySlots) {
      NLU.conversation.activeContext = {
        ...DEFAULT_ACTIVE_CONTEXT,
        lang: BRAIN.lang,
        slots,
        isInActionLoop: false,
        originalUtterance: NLU.nluResult.utterance,
        skillConfigPath: NLU.nluResult.skillConfigPath,
        actionName: NLU.nluResult.classification.action,
        domain: NLU.nluResult.classification.domain,
        intent,
        entities: NLU.nluResult.entities
      }

      const notFilledSlot = NLU.conversation.getNotFilledSlot()
      // Loop for questions if a slot hasn't been filled
      if (notFilledSlot) {
        const { actions } = SkillDomainHelper.getSkillConfig(
          NLU.nluResult.skillConfigPath,
          BRAIN.lang
        )
        const [currentSlot] =
          actions[NLU.nluResult.classification.action]?.slots?.filter(
            ({ name }) => name === notFilledSlot.name
          ) ?? []

        SOCKET_SERVER.socket.emit('suggest', currentSlot?.suggestions)
        BRAIN.talk(notFilledSlot.pickedQuestion)
        SOCKET_SERVER.socket.emit('is-typing', false)

        return true
      }
    }

    return false
  }
}

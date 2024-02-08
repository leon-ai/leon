import { join } from 'node:path'

import type { NLPUtterance } from '@/core/nlp/types'
import type { BrainProcessResult } from '@/core/brain/types'
import { MODEL_LOADER, NER } from '@/core'
import NaturalLanguageUnderstanding, {
  DEFAULT_NLU_RESULT
} from '@/core/nlp/nlu/nlu'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'
import { DEFAULT_ACTIVE_CONTEXT } from '@/core/nlp/conversation'

export class SlotFilling {
  private nlu!: NaturalLanguageUnderstanding
  constructor(nlu: NaturalLanguageUnderstanding) {
    this.nlu = nlu
  }
  /**
   * Handle slot filling
   */
  public async handle(
    utterance: NLPUtterance
  ): Promise<Partial<BrainProcessResult> | null> {
    const processedData = await this.fillSlot(utterance)

    /**
     * In case the slot filling has been interrupted. e.g. context change, etc.
     * Then reprocess with the new utterance
     */
    if (!processedData) {
      await this.nlu.process(utterance)
      return null
    }

    if (processedData && Object.keys(processedData).length > 0) {
      // Set new context with the next action if there is one
      if (processedData.action?.next_action) {
        await this.nlu.conversation.setActiveContext({
          ...DEFAULT_ACTIVE_CONTEXT,
          lang: this.nlu.brain.lang,
          slots: processedData.slots || {},
          isInActionLoop: !!processedData.nextAction?.loop,
          originalUtterance: processedData.utterance ?? null,
          skillConfigPath: processedData.skillConfigPath || '',
          actionName: processedData.action.next_action,
          domain: processedData.classification?.domain || '',
          intent: `${processedData.classification?.skill}.${processedData.action.next_action}`,
          entities: []
        })
      }
    }

    return processedData
  }

  /**
   * Build NLU data result object based on slots
   * and ask for more entities if necessary
   */
  public async fillSlot(
    utterance: NLPUtterance
  ): Promise<Partial<BrainProcessResult> | null> {
    if (!this.nlu.conversation.activeContext.nextAction) {
      return null
    }

    const { domain, intent } = this.nlu.conversation.activeContext
    const [skillName, actionName] = intent.split('.') as [string, string]
    const skillConfigPath = join(
      process.cwd(),
      'skills',
      domain,
      skillName,
      'config',
      this.nlu.brain.lang + '.json'
    )

    this.nlu.nluResult = {
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
      this.nlu.brain.lang,
      skillConfigPath,
      this.nlu.nluResult
    )

    // Continue to loop for questions if a slot has been filled correctly
    let notFilledSlot = this.nlu.conversation.getNotFilledSlot()
    if (notFilledSlot && entities.length > 0) {
      const hasMatch = entities.some(
        ({ entity }) => entity === notFilledSlot?.expectedEntity
      )

      if (hasMatch) {
        this.nlu.conversation.setSlots(this.nlu.brain.lang, entities)

        notFilledSlot = this.nlu.conversation.getNotFilledSlot()
        if (notFilledSlot) {
          this.nlu.brain.talk(notFilledSlot.pickedQuestion)
          this.nlu.brain.socket?.emit('is-typing', false)

          return {}
        }
      }
    }

    if (!this.nlu.conversation.areSlotsAllFilled()) {
      this.nlu.brain.talk(
        `${this.nlu.brain.wernicke('random_context_out_of_topic')}.`
      )
    } else {
      this.nlu.nluResult = {
        ...DEFAULT_NLU_RESULT, // Reset entities, slots, etc.
        // Assign slots only if there is a next action
        slots: this.nlu.conversation.activeContext.nextAction
          ? this.nlu.conversation.activeContext.slots
          : {},
        utterance: this.nlu.conversation.activeContext.originalUtterance ?? '',
        skillConfigPath,
        classification: {
          domain,
          skill: skillName,
          action: this.nlu.conversation.activeContext.nextAction,
          confidence: 1
        }
      }

      this.nlu.conversation.cleanActiveContext()

      return this.nlu.brain.execute(this.nlu.nluResult)
    }

    this.nlu.conversation.cleanActiveContext()
    return null
  }

  /**
   * Decide what to do with slot filling.
   * 1. Activate context
   * 2. If the context is expecting slots, then loop over questions to slot fill
   * 3. Or go to the brain executor if all slots have been filled in one shot
   */
  public async route(intent: string): Promise<boolean> {
    const slots =
      await MODEL_LOADER.mainNLPContainer.slotManager.getMandatorySlots(intent)
    const hasMandatorySlots = Object.keys(slots)?.length > 0

    if (hasMandatorySlots) {
      await this.nlu.conversation.setActiveContext({
        ...DEFAULT_ACTIVE_CONTEXT,
        lang: this.nlu.brain.lang,
        slots,
        isInActionLoop: false,
        originalUtterance: this.nlu.nluResult.utterance,
        skillConfigPath: this.nlu.nluResult.skillConfigPath,
        actionName: this.nlu.nluResult.classification.action,
        domain: this.nlu.nluResult.classification.domain,
        intent,
        entities: this.nlu.nluResult.entities
      })

      const notFilledSlot = this.nlu.conversation.getNotFilledSlot()
      // Loop for questions if a slot hasn't been filled
      if (notFilledSlot) {
        const { actions } = await SkillDomainHelper.getSkillConfig(
          this.nlu.nluResult.skillConfigPath,
          this.nlu.brain.lang
        )
        const [currentSlot] =
          actions[this.nlu.nluResult.classification.action]?.slots?.filter(
            ({ name }) => name === notFilledSlot.name
          ) ?? []

        this.nlu.brain.socket?.emit('suggest', currentSlot?.suggestions)
        this.nlu.brain.talk(notFilledSlot.pickedQuestion)
        this.nlu.brain.socket?.emit('is-typing', false)

        return true
      }
    }

    return false
  }
}

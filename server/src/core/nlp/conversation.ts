import type { ShortLanguageCode } from '@/types'
import type {
  NEREntity,
  NLPAction,
  NLPDomain,
  NLPUtterance,
  NLUSlot,
  NLUSlots
} from '@/core/nlp/types'
import { LogHelper } from '@/helpers/log-helper'
import { SkillDomainHelper } from '@/helpers/skill-domain-helper'

interface ConversationContext {
  name: string | null
  domain: NLPDomain
  intent: string
  currentEntities: NEREntity[]
  entities: NEREntity[]
  slots: NLUSlots
  isInActionLoop: boolean
  nextAction: NLPAction | null
  originalUtterance: NLPUtterance | null
  activatedAt: number
  skillConfigPath: string
  actionName: NLPAction
  lang: ShortLanguageCode
}

type ConversationPreviousContext = Record<string, ConversationContext> | null

const MAX_CONTEXT_HISTORY = 5
export const DEFAULT_ACTIVE_CONTEXT = {
  name: null,
  domain: '',
  intent: '',
  currentEntities: [],
  entities: [],
  slots: {},
  isInActionLoop: false,
  nextAction: null,
  originalUtterance: null,
  activatedAt: 0,
  skillConfigPath: '',
  actionName: '',
  lang: 'en'
}

export default class Conversation {
  // Identify conversations to allow more features in the future (multiple speakers, etc.)
  public id: string
  private _previousContexts: ConversationPreviousContext = {}
  private _activeContext: ConversationContext = DEFAULT_ACTIVE_CONTEXT

  constructor(id = 'conv0') {
    this.id = id

    LogHelper.title('Conversation')
    LogHelper.success('New instance')
  }

  public get activeContext(): ConversationContext {
    return this._activeContext
  }

  /**
   * Activate context according to the triggered action
   */
  public set activeContext(nluContext: ConversationContext) {
    const {
      slots,
      isInActionLoop,
      skillConfigPath,
      actionName,
      lang,
      domain,
      intent,
      entities
    } = nluContext
    const slotKeys = Object.keys(slots)
    const [skillName] = intent.split('.')
    const newContextName = `${domain}.${skillName}`
    const { actions } = SkillDomainHelper.getSkillConfig(skillConfigPath, lang)
    // Grab next action from the NLU data file
    const { next_action: nextAction } = actions[actionName] as { next_action: string }

    // If slots are required to trigger next actions, then go through the context activation
    if (slotKeys.length > 0) {
      /**
       * If a new context is triggered
       * then save the current active context to the contexts history
       */
      if (this._activeContext.name !== newContextName) {
        this.pushToPreviousContextsStack()
        // Activate new context
        this._activeContext = {
          ...DEFAULT_ACTIVE_CONTEXT,
          name: newContextName,
          domain,
          intent,
          currentEntities: [],
          entities: [],
          slots: {},
          isInActionLoop,
          nextAction,
          originalUtterance: nluContext.originalUtterance,
          activatedAt: Date.now()
        }

        LogHelper.title('Conversation')
        LogHelper.info(`New active context: ${newContextName}`)
      }

      this.setSlots(lang, entities, slots)
    } else {
      const [skillName] = intent.split('.')
      const newContextName = `${domain}.${skillName}`

      if (
        this._activeContext.name &&
        this._activeContext.name !== newContextName
      ) {
        this.cleanActiveContext()
      }

      /**
       * Activate new context and persist entities in a new context
       * as long as the skill is being used
       */
      if (this._activeContext.name !== newContextName) {
        // Activate new context
        this._activeContext = {
          ...DEFAULT_ACTIVE_CONTEXT,
          name: newContextName,
          domain,
          intent,
          currentEntities: entities,
          entities,
          slots: {},
          isInActionLoop,
          nextAction,
          originalUtterance: nluContext.originalUtterance,
          activatedAt: Date.now()
        }

        LogHelper.title('Conversation')
        LogHelper.info(`New active context: ${newContextName}`)
      } else {
        this._activeContext.currentEntities = entities
        // Add new entities at the end of the context entities array
        this._activeContext.entities.push(...entities)
      }
    }
  }

  public get previousContexts(): ConversationPreviousContext {
    return this._previousContexts
  }

  /**
   * Check whether there is an active context
   */
  public hasActiveContext(): boolean {
    return !!this._activeContext.name
  }

  /**
   * Set slots in active context
   */
  public setSlots(
    lang: ShortLanguageCode,
    entities: NEREntity[],
    slots = this._activeContext.slots
  ): void {
    const slotKeys = Object.keys(slots)

    for (let i = 0; i < slotKeys.length; i += 1) {
      const key = slotKeys[i] as string
      const slotObj = slots[key] as NLUSlot
      const isFirstSet = key.includes('#')
      let slotName = slotObj.name
      let slotEntity = slotObj.expectedEntity
      let { questions } = slotObj

      // If it's the first slot setting grabbed from the model or not
      if (isFirstSet) {
        [slotName, slotEntity] = key.split('#') as [string, string]
        questions = slotObj.locales?.[lang] as string[]
      }

      // Match the slot with the submitted entity and ensure the slot hasn't been filled yet
      const [foundEntity] = entities.filter(
        ({ entity }) => entity === slotEntity && !slotObj.isFilled
      )
      const pickedQuestion =
        questions[Math.floor(Math.random() * questions.length)] as string
      const slot = this._activeContext.slots[slotName]
      const newSlot = {
        name: slotName,
        expectedEntity: slotEntity,
        // Map the entity with the slot or use the existing value if there is one
        value: foundEntity || slotObj.value,
        isFilled: !!foundEntity,
        questions,
        pickedQuestion
      }

      /**
       * When the slot isn't set or not filled yet
       * or if it already set but the value has changed
       * then set the slot
       */
      if (
        !slot ||
        !slot.isFilled ||
        (slot.isFilled &&
          newSlot.isFilled &&
          'value' in slot.value.resolution &&
          'value' in newSlot.value.resolution &&
          slot.value.resolution.value !== newSlot.value.resolution.value)
      ) {
        if (newSlot?.isFilled) {
          LogHelper.title('Conversation')
          LogHelper.success(
            `Slot filled: { name: ${newSlot.name}, value: ${JSON.stringify(
              newSlot.value
            )} }`
          )
        }
        this._activeContext.slots[slotName] = newSlot
        entities.shift()
      }
    }
  }

  /**
   * Get the not yet filled slot if there is any
   */
  public getNotFilledSlot(): NLUSlot | null {
    const slotsKeys = Object.keys(this._activeContext.slots)
    const [notFilledSlotKey] = slotsKeys.filter(
      (slotKey) => !this._activeContext.slots[slotKey]?.isFilled
    )

    if (notFilledSlotKey !== undefined) {
      return this._activeContext.slots[notFilledSlotKey] as NLUSlot
    }

    return null
  }

  /**
   * Check whether slots are all filled
   */
  public areSlotsAllFilled(): boolean {
    return !this.getNotFilledSlot()
  }

  /**
   * Clean up active context
   */
  public cleanActiveContext(): void {
    LogHelper.title('Conversation')
    LogHelper.info('Clean active context')

    this.pushToPreviousContextsStack()
    this._activeContext = DEFAULT_ACTIVE_CONTEXT
  }

  /**
   * Push active context to the previous contexts stack
   */
  private pushToPreviousContextsStack(): void {
    if (this._previousContexts) {
      const previousContextsKeys = Object.keys(this._previousContexts)

      // Remove the oldest context from the history stack if it reaches the maximum limit
      if (previousContextsKeys.length >= MAX_CONTEXT_HISTORY) {
        delete this._previousContexts[previousContextsKeys[0] as string]
      }

      if (this._activeContext.name) {
        this._previousContexts[this._activeContext.name] = this._activeContext
      }
    } else {
      LogHelper.warning('No previous context found')
    }
  }
}

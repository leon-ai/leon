import fs from 'node:fs'

import type { ShortLanguageCode } from '@/types'
import type {
  NEREntity,
  NLPAction,
  NLPDomain,
  NLPUtterance,
  NLUSlots
} from '@/core/nlp/types'
import type { SkillConfigSchema } from '@/schemas/skill-schemas'
import { LogHelper } from '@/helpers/log-helper'

interface ConversationContext {
  name: string | null
  domain: NLPDomain | null
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
const DEFAULT_ACTIVE_CONTEXT = {
  name: null,
  domain: null,
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
    const { actions }: { actions: SkillConfigSchema['actions'] } = JSON.parse(
      fs.readFileSync(skillConfigPath, 'utf8')
    )
    // Grab next action from the NLU data file
    const { next_action: nextAction } = actions[actionName]

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
  setSlots(lang, entities, slots = this._activeContext.slots) {
    const slotKeys = Object.keys(slots)

    for (let i = 0; i < slotKeys.length; i += 1) {
      const key = slotKeys[i]
      const slotObj = slots[key]
      const isFirstSet = key.includes('#')
      let slotName = slotObj.name
      let slotEntity = slotObj.expectedEntity
      let { questions } = slotObj

      // If it's the first slot setting grabbed from the model or not
      if (isFirstSet) {
        ;[slotName, slotEntity] = key.split('#')
        questions = slotObj.locales[lang]
      }

      // Match the slot with the submitted entity and ensure the slot hasn't been filled yet
      const [foundEntity] = entities.filter(
        ({ entity }) => entity === slotEntity && !slotObj.isFilled
      )
      const pickedQuestion =
        questions[Math.floor(Math.random() * questions.length)]
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
  getNotFilledSlot() {
    const slotsKeys = Object.keys(this._activeContext.slots)
    const [notFilledSlotKey] = slotsKeys.filter(
      (slotKey) => !this._activeContext.slots[slotKey].isFilled
    )

    return this._activeContext.slots[notFilledSlotKey]
  }

  /**
   * Check whether slots are all filled
   */
  areSlotsAllFilled() {
    return !this.getNotFilledSlot()
  }

  /**
   * Clean up active context
   */
  cleanActiveContext() {
    LogHelper.title('Conversation')
    LogHelper.info('Clean active context')

    this.pushToPreviousContextsStack()
    this._activeContext = DEFAULT_ACTIVE_CONTEXT
  }

  /**
   * Push active context to the previous contexts stack
   */
  pushToPreviousContextsStack() {
    const previousContextsKeys = Object.keys(this._previousContexts)

    // Remove the oldest context from the history stack if it reaches the maximum limit
    if (previousContextsKeys.length >= MAX_CONTEXT_HISTORY) {
      delete this._previousContexts[previousContextsKeys[0]]
    }

    if (this._activeContext.name) {
      this._previousContexts[this._activeContext.name] = this._activeContext
    }
  }
}

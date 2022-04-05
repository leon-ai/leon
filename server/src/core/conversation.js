import log from '@/helpers/log'
import fs from 'fs'

const maxContextHistory = 5
const defaultActiveContext = {
  name: null,
  domain: null,
  intent: null,
  entities: [],
  slots: { },
  nextAction: null,
  originalUtterance: null,
  activatedAt: 0
}

class Conversation {
  constructor (id = 'conv0') {
    // Identify conversations to allow more features in the future (multiple speakers, etc.)
    this._id = id
    this._activeContext = defaultActiveContext
    this._previousContexts = { }

    log.title('Conversation')
    log.success('New instance')
  }

  get id () {
    return this._id
  }

  get activeContext () {
    return this._activeContext
  }

  get previousContexts () {
    return this._previousContexts
  }

  /**
   * Check whether there is an active context
   */
  hasActiveContext () {
    return !!this._activeContext.name
  }

  /**
   * Activate context according to the triggered action
   */
  set activeContext (contextObj) {
    const {
      slots,
      nluDataFilePath,
      actionName,
      lang,
      domain,
      intent,
      entities
    } = contextObj
    const slotKeys = Object.keys(slots)

    // If slots are required to trigger next actions, then go through the context activation
    if (slotKeys.length > 0) {
      const { actions } = JSON.parse(fs.readFileSync(nluDataFilePath, 'utf8'))
      const actionsKeys = Object.keys(actions)
      // Grab output context from the NLU data file
      const { output_context: outputContext } = actions[actionName]
      // Define next action
      const [nextAction] = actionsKeys.filter((key) => actions[key].input_context === outputContext)

      /**
       * If there is an active context and a new one is triggered
       * then save the current active context to the contexts history
       */
      if (this._activeContext.name && this._activeContext.name !== outputContext) {
        this.pushToPreviousContextsStack()
      } else if (!this._activeContext.name) {
        // Activate new context
        this._activeContext = {
          ...defaultActiveContext,
          name: outputContext,
          domain,
          intent,
          nextAction,
          originalUtterance: contextObj.originalUtterance,
          activatedAt: Date.now()
        }

        log.title('Conversation')
        log.info(`New active context: ${outputContext}`)
      }

      this.setSlots(lang, entities, slots)
    } else if (entities.length > 0) {
      console.log('entities', entities)
      // Activate new context
      this._activeContext = {
        ...defaultActiveContext,
        name: 'test',
        domain,
        intent,
        entities,
        originalUtterance: contextObj.originalUtterance,
        activatedAt: Date.now()
      }

      console.log('1this._activeContext', this._activeContext)
    }
  }

  /**
   * Set slots in active context
   */
  setSlots (lang, entities, slots = this._activeContext.slots) {
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
        [slotName, slotEntity] = key.split('#')
        questions = slotObj.locales[lang]
      }

      const [foundEntity] = entities.filter(({ entity }) => entity === slotEntity)
      const pickedQuestion = questions[Math.floor(Math.random() * questions.length)]
      const slot = this._activeContext.slots[slotName]
      const newSlot = {
        name: slotName,
        expectedEntity: slotEntity,
        value: foundEntity,
        isFilled: !!foundEntity,
        questions,
        pickedQuestion
      }

      /**
       * When the slot isn't set or not filled yet
       * or if it already set but the value has changed
       * then set the slot
       */
      if (!slot || !slot.isFilled
        || (slot.isFilled && newSlot.isFilled
          && slot.value.resolution.value !== newSlot.value.resolution.value)
      ) {
        this._activeContext.slots[slotName] = newSlot
      }
    }
  }

  /**
   * Get the not yet filled slot if there is any
   */
  getNotFilledSlot () {
    const slotsKeys = Object.keys(this._activeContext.slots)
    const [notFilledSlotKey] = slotsKeys
      .filter((slotKey) => !this._activeContext.slots[slotKey].isFilled)

    return this._activeContext.slots[notFilledSlotKey]
  }

  /**
   * Check whether slots are all filled
   */
  areSlotsAllFilled () {
    return !this.getNotFilledSlot()
  }

  /**
   * Clean up active context
   */
  cleanActiveContext () {
    this.pushToPreviousContextsStack()
    this._activeContext = defaultActiveContext
  }

  /**
   * Push active context to the previous contexts stack
   */
  pushToPreviousContextsStack () {
    const previousContextsKeys = Object.keys(this._previousContexts)

    // Remove the oldest context from the history stack if it reaches the maximum limit
    if (previousContextsKeys.length >= maxContextHistory) {
      delete this._previousContexts[previousContextsKeys[0]]
    }

    this._previousContexts[this._activeContext.name] = this._activeContext
  }
}

export default Conversation

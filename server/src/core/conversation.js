import log from '@/helpers/log'
import fs from 'fs'

const maxContextHistory = 5

class Conversation {
  constructor (id = 'conv0') {
    // Identify conversations to allow more features in the future (multiple speakers, etc.)
    this._id = id
    this._activeContext = {
      name: null,
      slots: { },
      activatedAt: 0
    }
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
   * Get data of the current conversation instance
   */
  getCurrent () {
    return {
      id: this._id,
      activeContext: this._activeContext,
      previousContexts: this._previousContexts
    }
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
  setContext (contextObj) {
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
      // Grab output context from the NLU data file
      const { actions } = JSON.parse(fs.readFileSync(nluDataFilePath, 'utf8'))
      const { output_context: outputContext } = actions[actionName]

      /**
       * If there is an active context and a new one is triggered
       * then save the current active context to the contexts history
       */
      if (this._activeContext.name && this._activeContext.name !== outputContext) {
        const previousContextsKeys = Object.keys(this._previousContexts)

        // Remove oldest context from the history stack
        if (previousContextsKeys.length >= maxContextHistory) {
          delete this._previousContexts[previousContextsKeys[0]]
        }

        this._previousContexts[this._activeContext.name] = this._activeContext
      } else if (!this._activeContext.name) {
        // Activate new context
        this._activeContext.name = outputContext
        this._activeContext.activatedAt = Date.now()
      }

      this.setSlots(slots, {
        lang,
        domain,
        intent,
        entities
      })
    }
  }

  /**
   * Set slots in active context
   */
  setSlots (slots, valueObj) {
    const {
      lang,
      domain,
      intent,
      entities
    } = valueObj
    const slotKeys = Object.keys(slots)

    for (let i = 0; i < slotKeys.length; i += 1) {
      const key = slotKeys[i]
      const slotObj = slots[key]
      const [slotName, slotEntity] = key.split('#')
      const [foundEntity] = entities.filter(({ entity }) => entity === slotEntity)
      const questions = slotObj.locales[lang]
      const question = questions[Math.floor(Math.random() * questions.length)]
      const slot = this._activeContext.slots[slotName]
      const newSlot = {
        name: slotName,
        domain,
        intent,
        entity: slotEntity,
        value: foundEntity,
        isFilled: !!foundEntity,
        question
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
}

export default Conversation

import log from '@/helpers/log'

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
}

export default Conversation

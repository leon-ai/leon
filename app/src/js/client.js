import Chatbot from './chatbot'

const WS_READY_STATES = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
}

function createNewWebSocket(serverUrl) {
  return window.location.protocol === 'http:'
    ? new WebSocket(`ws://${serverUrl.split('://')[1]}/ws`)
    : new WebSocket(`wss://${serverUrl.split('://')[1]}/ws`)
}

export default class Client {
  constructor(client, serverUrl, input, res) {
    this.client = client
    this._input = input
    this._suggestionContainer = document.querySelector('#suggestions-container')
    this.serverUrl = serverUrl
    this.socket = createNewWebSocket(serverUrl)
    this.history = localStorage.getItem('history')
    this.parsedHistory = []
    this.info = res
    this.chatbot = new Chatbot()
    this._recorder = {}
    this._suggestions = []
  }

  set input(newInput) {
    if (typeof newInput !== 'undefined') {
      this._input.value = newInput
    }
  }

  set recorder(recorder) {
    this._recorder = recorder
  }

  get recorder() {
    return this._recorder
  }

  sendSocketMessage(event, data) {
    if (this.socket.readyState !== WS_READY_STATES.OPEN) {
      console.error('Socket not ready')

      /**
       * Auto reconnect WebSocket and send the message again
       */

      setTimeout(() => {
        this.socket = createNewWebSocket(this.serverUrl)

        this.initSocket()
      }, 250)

      setTimeout(() => {
        this.sendSocketMessage(event, data)
      }, 500)

      return
    }

    this.socket.send(
      JSON.stringify({
        event,
        data,
        sentAt: Date.now(),
        client: this.client
      })
    )
  }

  init(loader) {
    this.chatbot.init()

    this.initSocket(loader)

    if (this.history !== null) {
      this.parsedHistory = JSON.parse(this.history)
    }
  }

  initSocket(loader) {
    const eventHandlers = {
      ready: () => {
        loader.stop()
      },
      answer: (data) => {
        this.chatbot.receivedFrom('leon', data)
      },
      suggest: (data) => {
        data?.forEach((suggestionText) => {
          this.addSuggestion(suggestionText)
        })
      },
      'is-typing': (data) => {
        this.chatbot.isTyping('leon', data)
      },
      recognized: (data, cb) => {
        this._input.value = data
        this.send('utterance')

        cb('string-received')
      },
      'audio-forwarded': (data, cb) => {
        const ctx = new AudioContext()
        const source = ctx.createBufferSource()

        ctx.decodeAudioData(data.buffer, (buffer) => {
          source.buffer = buffer

          source.connect(ctx.destination)
          source.start(0)

          /**
           * When the after speech option is enabled and
           * the answer is a final one
           */
          if (this.info.after_speech && data.is_final_answer) {
            // Enable recording after the speech + 500ms
            setTimeout(() => {
              this._recorder.start()
              this._recorder.enabled = true

              // Check every second if the recorder is enabled to stop it
              const id = setInterval(() => {
                if (this._recorder.enabled) {
                  if (this._recorder.countSilenceAfterTalk <= 8) {
                    // Stop recording if there was no noise for 8 seconds
                    if (this._recorder.countSilenceAfterTalk === 8) {
                      this._recorder.stop()
                      this._recorder.enabled = false
                      this._recorder.countSilenceAfterTalk = 0
                      clearInterval(id)
                    } else if (!this._recorder.noiseDetected) {
                      this._recorder.countSilenceAfterTalk += 1
                    } else {
                      clearInterval(id)
                    }
                  }
                }
              }, 1_000)
            }, data.duration + 500)
          }
        })

        cb('audio-received')
      },
      download: (data) => {
        window.location = `${this.serverUrl}/api/v1/downloads?domain=${data.domain}&skill=${data.skill}`
      }
    }

    this.socket.addEventListener('open', () => {
      this.socket.addEventListener('message', (message) => {
        const { event, data } = JSON.parse(message.data)

        eventHandlers[event](data)
      })
    })
  }

  send(keyword) {
    if (this._input.value !== '') {
      this.sendSocketMessage(keyword, this._input.value.trim())
      this.chatbot.sendTo('leon', this._input.value)

      this._suggestions.forEach((suggestion) => {
        // Remove all event listeners of the suggestion
        suggestion.replaceWith(suggestion.cloneNode(true))
        this._suggestionContainer.replaceChildren()
      })

      this.save()

      return true
    }

    return false
  }

  save() {
    let val = this._input.value

    if (localStorage.getItem('history') === null) {
      localStorage.setItem('history', JSON.stringify([]))
      this.parsedHistory = JSON.parse(localStorage.getItem('history'))
    } else if (this.parsedHistory.length >= 32) {
      this.parsedHistory.shift()
    }

    if (val[0] === ' ') {
      val = val.substr(1, val.length - 1)
    }

    if (this.parsedHistory[this.parsedHistory.length - 1] !== val) {
      this.parsedHistory.push(val)
      localStorage.setItem('history', JSON.stringify(this.parsedHistory))
    }

    this._input.value = ''
  }

  addSuggestion(text) {
    const newSuggestion = document.createElement('button')
    newSuggestion.classList.add('suggestion')
    newSuggestion.textContent = text

    this._suggestionContainer.appendChild(newSuggestion)

    newSuggestion.addEventListener('click', (e) => {
      e.preventDefault()
      this.input = e.target.textContent
      this.send('utterance')
    })

    this._suggestions.push(newSuggestion)
  }
}

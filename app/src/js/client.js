import { io } from 'socket.io-client'
import React from 'react'
import { createRoot } from 'react-dom/client'

import { Button } from './aurora/button'
import Chatbot from './chatbot'
import { INIT_MESSAGES } from './constants'

export default class Client {
  constructor(client, serverUrl, input, res) {
    this.client = client
    this._input = input
    this._suggestionContainer = document.querySelector('#suggestions-container')
    this.serverUrl = serverUrl
    this.socket = io(this.serverUrl)
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

  async sendInitMessages() {
    for (let i = 0; i < INIT_MESSAGES.length; i++) {
      const messages = INIT_MESSAGES[i]
      const message = messages[Math.floor(Math.random() * messages.length)]
      const sendingDelay = Math.floor(Math.random() * 2000) + 1000
      const typingFactorDelay = Math.floor(Math.random() * 4) + 2

      setTimeout(() => {
        this.chatbot.isTyping('leon', true)
      }, sendingDelay / typingFactorDelay)

      await new Promise((resolve) => setTimeout(resolve, sendingDelay))

      this.chatbot.receivedFrom('leon', message)
      this.chatbot.isTyping('leon', false)
    }
  }

  init(loader) {
    this.chatbot.init()

    this.socket.on('connect', () => {
      this.socket.emit('init', this.client)
    })

    this.socket.on('ready', () => {
      loader.stop()

      if (this.chatbot.parsedBubbles?.length === 0) {
        this.sendInitMessages()
      }
    })

    this.socket.on('answer', (data) => {
      this.chatbot.receivedFrom('leon', data)
    })

    this.socket.on('suggest', (data) => {
      data?.forEach((suggestionText) => {
        this.addSuggestion(suggestionText)
      })
    })

    this.socket.on('is-typing', (data) => {
      this.chatbot.isTyping('leon', data)
    })

    this.socket.on('recognized', (data, cb) => {
      this._input.value = data
      this.send('utterance')

      cb('string-received')
    })

    this.socket.on('widget', (data) => {
      /**
       * TODO: widget: widget handler to core/skill; dynamic component rendering
       */
      console.log('data', data)

      const container = document.createElement('div')
      container.className = 'widget'
      this.chatbot.feed.appendChild(container)

      const root = createRoot(container)

      // TODO: widget: pass props and dynamic component loading according to type
      const widgets = {
        Button: (options) => {
          return Button({
            children: options.text
          })
        }
      }

      root.render(widgets[data.type](data.options))
    })

    this.socket.on('audio-forwarded', (data, cb) => {
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
    })

    if (this.history !== null) {
      this.parsedHistory = JSON.parse(this.history)
    }
  }

  send(keyword) {
    if (this._input.value !== '') {
      this.socket.emit(keyword, {
        client: this.client,
        value: this._input.value.trim()
      })
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

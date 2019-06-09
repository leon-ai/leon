'use strict'

import Chatbot from './chatbot.es6'

export default class Client {
  constructor (client, serverUrl, input, res) {
    this.client = client
    this._input = input
    this.serverUrl = serverUrl
    this.socket = io.connect(this.serverUrl)
    this.history = localStorage.getItem('history')
    this.parsedHistory = []
    this.info = res
    this.chatbot = new Chatbot()
    this._recorder = { }
  }

  set input (newInput) {
    if (typeof newInput !== 'undefined') {
      this._input.value = newInput
    }
  }

  set recorder (recorder) {
    this._recorder = recorder
  }

  get recorder () {
    return this._recorder
  }

  init () {
    this.chatbot.init()

    this.socket.on('connect', () => {
      this.socket.emit('init', this.client)
    })

    this.socket.on('answer', (data) => {
      this.chatbot.receivedFrom('leon', data)
    })

    this.socket.on('is-typing', (data) => {
      this.chatbot.isTyping('leon', data)
    })

    this.socket.on('recognized', (data, cb) => {
      this._input.value = data
      this.send('query')

      cb('string-received')
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
            }, 1000)
          }, data.duration + 500)
        }
      })

      cb('audio-received')
    })

    this.socket.on('download', (data) => {
      window.location = `${this.serverUrl}/v1/downloads?package=${data.package}&module=${data.module}`
    })

    if (this.history !== null) {
      this.parsedHistory = JSON.parse(this.history)
    }
  }

  send (keyword) {
    if (this._input.value !== '') {
      this.socket.emit(keyword, { client: this.client, value: this._input.value.trim() })
      this.chatbot.sendTo('leon', this._input.value)

      this.save()

      return true
    }

    return false
  }

  save () {
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
}

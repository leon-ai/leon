import { io } from 'socket.io-client'

import Chatbot from './chatbot'
import VoiceEnergy from './voice-energy'
import { INIT_MESSAGES } from './constants'
import handleSuggestions from './suggestion-handler.js'

export default class Client {
  constructor(client, serverUrl, input, options = {}) {
    this.client = client
    this._input = input
    this.voiceSpeechElement = document.querySelector('#voice-speech')
    this.serverUrl = serverUrl
    this.socket = io(this.serverUrl)
    this.activeSessionId = options.activeSessionId || null
    this.history = localStorage.getItem('history')
    this.parsedHistory = []
    this.chatbot = new Chatbot(this.socket, this.serverUrl, this.activeSessionId)
    this.voiceEnergy = new VoiceEnergy(this)
    this._recorder = {}
    this._suggestions = []
    this._answerGenerationId = 'xxx'
    this._activeStreamGenerationId = null
    this._ttsAudioContext = null
    this._isLeonGeneratingAnswer = false
    this._isVoiceModeEnabled = false
    this._hasSentInitMessages = false
    this._chatbotInitPromise = null
    // this._ttsAudioContextes = {}
  }

  set input(newInput) {
    if (typeof newInput !== 'undefined') {
      this._input.value = newInput
    }
  }

  get input() {
    return this._input
  }

  set recorder(recorder) {
    this._recorder = recorder
  }

  get recorder() {
    return this._recorder
  }

  updateMood(mood) {
    const moodContainer = document.querySelector('#mood')

    if (!moodContainer || !mood?.emoji || !mood?.type) {
      return
    }

    moodContainer.textContent = `Leon's mood: ${mood.emoji}`
    moodContainer.setAttribute('title', mood.type)
  }

  setSessionPanel(sessionPanel) {
    this.sessionPanel = sessionPanel
  }

  async setActiveSession(sessionId) {
    if (!sessionId || sessionId === this.activeSessionId) {
      return
    }

    this.activeSessionId = sessionId
    this.chatbot.setSessionId(sessionId)
    this.socket.emit('session-change', sessionId)
    await this.chatbot.loadFeed()
    this.chatbot.scrollDown({ force: true })
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

  setInitStatus(statusName, statusType) {
    window.leonInitStatusEvent.dispatchEvent(
      new CustomEvent('initStatusChange', {
        detail: {
          statusName,
          statusType
        }
      })
    )
  }

  waitForInitUICompletion() {
    if (this._hasSentInitMessages || this.chatbot.parsedBubbles?.length > 0) {
      return
    }

    const trySendInitMessages = () => {
      const initializedInitElement = document.querySelector('#init .initialized')

      if (!initializedInitElement) {
        return false
      }

      this._hasSentInitMessages = true
      this.sendInitMessages()
      return true
    }

    if (trySendInitMessages()) {
      return
    }

    const interval = setInterval(() => {
      if (trySendInitMessages()) {
        clearInterval(interval)
      }
    }, 100)
  }

  asrStartRecording() {
    if (!window.leonConfigInfo.stt.enabled) {
      console.warn('ASR is not enabled')
      return
    }

    if (!this._isVoiceModeEnabled) {
      this.enableVoiceMode()

      this.voiceEnergy.status = 'listening'

      this.socket.emit('asr-start-record')
    }
  }

  init() {
    this._chatbotInitPromise = this.chatbot.init()
    this.voiceEnergy.init()

    if (window.leonConfigInfo?.tcpServer?.enabled === false) {
      this.setInitStatus('tcpServerBoot', 'success')
    }

    this.socket.on('connect', () => {
      this.socket.emit('init', {
        client: this.client,
        sessionId: this.activeSessionId,
        capabilities: {
          supportsWidgets: true
        }
      })
    })

    /**
     * Init status listeners
     */
    this.socket.on('init-client-core-server-handshake', (status) => {
      this.setInitStatus('clientCoreServerHandshake', status)
    })
    this.socket.on('init-tcp-server-boot', (status) => {
      this.setInitStatus('tcpServerBoot', status)
    })
    this.socket.on('init-llama-server-boot', (status) => {
      this.setInitStatus('llamaServerBoot', status)
    })

    this.socket.on('ready', () => {
      void this._chatbotInitPromise?.then(() => {
        setTimeout(() => {
          const body = document.querySelector('body')
          body.classList.remove('settingup')
        }, 250)

        this.waitForInitUICompletion()
      })
    })

    this.socket.on('answer', (data) => {
      /*if (this._isVoiceModeEnabled) {
        this.voiceEnergy.status = 'listening'
      }*/

      // Leon has finished to answer
      this._isLeonGeneratingAnswer = false

      const isPlanWidget =
        data && typeof data === 'object' && data.widget === 'PlanWidget'

      if (isPlanWidget) {
        this.chatbot.isTyping('leon', false)
      }

      /**
       * Handle message replacement if replaceMessageId is provided
       */
      if (data.replaceMessageId) {
        this.chatbot.replaceMessage(data.replaceMessageId, data)
        return
      }

      /**
       * Handle tool output messages
       */
      if (data.isToolOutput) {
        this.chatbot.handleToolOutput(data)
        return
      }

      /**
       * Handle widget data directly
       */
      if (data.widget || data.componentTree) {
        const isSystemWidget = this.chatbot.isSystemWidgetData(data)
        // Pass the entire widget data as JSON string for chatbot.js to handle
        const widgetString =
          typeof data === 'string' ? data : JSON.stringify(data)

        this.chatbot.createBubble({
          who: 'leon',
          string: widgetString,
          save: !isSystemWidget,
          messageId: data.widget?.id || data.id || `msg-${Date.now()}`
        })

        return
      }

      const answerText = typeof data === 'string' ? data : data.answer
      const llmMetrics =
        data && typeof data === 'object' && data.llmMetrics
          ? data.llmMetrics
          : null

      /**
       * Just save the bubble if the newest bubble is from the streaming.
       * Otherwise, create a new bubble
       */
      const streamGenerationId =
        this._activeStreamGenerationId || this._answerGenerationId
      const streamedBubbleContainerElement = streamGenerationId
        ? document.querySelector(
            `.bubble-container.leon.${streamGenerationId}`
          )
        : null
      const isBubbleFromStreaming = Boolean(streamedBubbleContainerElement)

      if (isBubbleFromStreaming && streamedBubbleContainerElement) {
        this.chatbot.saveBubble(
          'leon',
          answerText,
          answerText,
          null,
          llmMetrics,
          data && typeof data === 'object' && typeof data.sentAt === 'number'
            ? data.sentAt
            : Date.now()
        )

        // Slightly delay the update to avoid the stream animation to be interrupted
        setTimeout(() => {
          // Update the text of the bubble (quick emoji fix)
          streamedBubbleContainerElement.querySelector('p.bubble').innerHTML =
            this.chatbot.formatMessage(answerText)
          this.chatbot.updateBubbleMetrics(
            streamedBubbleContainerElement,
            llmMetrics,
            data && typeof data === 'object' && typeof data.sentAt === 'number'
              ? data.sentAt
              : Date.now()
          )
        }, 2_500)
      } else {
        this.chatbot.createBubble({
          who: 'leon',
          string: answerText,
          save:
            !(
              data &&
              typeof data === 'object' &&
              data.historyMode === 'system_widget'
            ),
          metrics: llmMetrics,
          messageId: data && typeof data === 'object' ? data.messageId : null,
          sentAt:
            data && typeof data === 'object' && typeof data.sentAt === 'number'
              ? data.sentAt
              : Date.now()
        })
      }
      this.chatbot.scrollDown({ force: true })

      this._activeStreamGenerationId = null
      this._answerGenerationId = 'xxx'
      void this.sessionPanel?.refresh()
    })

    this.socket.on('suggest', (data) => {
      setTimeout(() => {
        handleSuggestions(data, this.chatbot, this)
      }, 400)
      setTimeout(() => {
        this.chatbot.scrollDown()
      }, 450)
      /*data?.forEach((suggestionText) => {
        this.addSuggestion(suggestionText)
      })*/
    })

    this.socket.on('is-typing', (data) => {
      this.chatbot.isTyping('leon', data)
    })

    this.socket.on('owner-utterance', (data) => {
      if (!data?.utterance) {
        return
      }

      this.chatbot.createBubble({
        who: 'me',
        string: data.utterance,
        messageId: data.messageId,
        sentAt: typeof data.sentAt === 'number' ? data.sentAt : Date.now()
      })
    })

    this.socket.on('recognized', (data, cb) => {
      this._input.value = data
      this.send('utterance')

      cb('string-received')
    })

    this.socket.on('widget-send-utterance', (utterance) => {
      this._input.value = utterance
      this.send('utterance')
    })

    this.socket.on('new-mood', (mood) => {
      this.updateMood(mood)
    })

    this.socket.on('llm-token', (data) => {
      if (this._isVoiceModeEnabled) {
        this.voiceEnergy.status = 'processing'
      }

      this._isLeonGeneratingAnswer = true
      const previousGenerationId = this._answerGenerationId
      const newGenerationId = data.generationId
      this._answerGenerationId = newGenerationId
      this._activeStreamGenerationId = newGenerationId
      const isSameGeneration = previousGenerationId === newGenerationId
      let bubbleContainerElement = null

      if (!isSameGeneration) {
        bubbleContainerElement = this.chatbot.createBubble({
          who: 'leon',
          string: data.token,
          save: false,
          bubbleId: newGenerationId
        })
      } else {
        bubbleContainerElement = document.querySelector(
          `.${previousGenerationId}`
        )
      }

      const bubbleElement = bubbleContainerElement.querySelector('p.bubble')

      // Token is already appened when it's a new generation
      if (isSameGeneration) {
        // bubbleElement.textContent += data.token

        const tokenSpan = document.createElement('span')
        tokenSpan.className = 'llm-token fade-in'
        tokenSpan.textContent = data.token

        bubbleElement.appendChild(tokenSpan)
      }

      this.chatbot.scrollDown()
    })

    this.socket.on('llm-reasoning-token', (data) => {
      if (!data?.generationId || !data?.token) {
        return
      }

      if (this._isVoiceModeEnabled) {
        this.voiceEnergy.status = 'processing'
      }

      this._isLeonGeneratingAnswer = true
      this.chatbot.createOrUpdateReasoningBlock(
        data.generationId,
        data.token,
        data.phase
      )
      this.chatbot.scrollDown()
    })

    this.socket.on('asr-speech', (text) => {
      if (!this._isVoiceModeEnabled) {
        this.enableVoiceMode()
      }

      this.voiceEnergy.status = 'listening'
      this._input.value = text

      if (this.voiceSpeechElement) {
        this.voiceSpeechElement.textContent = text
      }
    })

    this.socket.on('asr-end-of-owner-speech', () => {
      this.voiceEnergy.status = 'processing'

      setTimeout(() => {
        this.send('utterance')
      }, 200)
    })

    this.socket.on('asr-active-listening-disabled', () => {
      this.voiceEnergy.status = 'idle'
    })

    /**
     * Only used for "local" TTS provider as a PoC for now.
     * Target to do a better implementation in the future
     * with streaming support
     */
    this.socket.on('tts-stream', (data) => {
      this.voiceEnergy.status = 'talking'

      // const { audioId, chunk } = data
      const { chunk } = data
      this._ttsAudioContext = new AudioContext()
      // this._ttsAudioContextes[audioId] = ctx

      const source = this._ttsAudioContext.createBufferSource()
      this._ttsAudioContext.decodeAudioData(chunk, (buffer) => {
        source.buffer = buffer

        source.connect(this._ttsAudioContext.destination)
        source.start(0)
      })
    })

    /**
     * When Leon got interrupted by the owner voice
     * while he is speaking
     */
    this.socket.on('tts-interruption', async () => {
      if (this._ttsAudioContext) {
        await this._ttsAudioContext.close()
      }
    })

    this.socket.on('tts-end-of-speech', async () => {
      this.voiceEnergy.status = 'listening'

      if (window.leonConfigInfo?.stt?.enabled) {
        this.socket.emit('asr-start-record')
      }
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
        if (window.leonConfigInfo.after_speech && data.is_final_answer) {
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
    if (keyword === 'utterance') {
      return this.sendUtterance(this._input.value)
    }

    return false
  }

  sendUtterance(value, options = {}) {
    if (this._isLeonGeneratingAnswer) {
      return false
    }

    const trimmedValue = String(value || '').trim()

    if (trimmedValue === '') {
      return false
    }

    const sentAt =
      typeof options.sentAt === 'number' ? options.sentAt : Date.now()

    this.socket.emit('utterance', {
      client: this.client,
      value: trimmedValue,
      sentAt,
      sessionId: this.activeSessionId,
      ...(options.commandContext
        ? { commandContext: options.commandContext }
        : {})
    })
    this.chatbot.sendTo('leon', trimmedValue, sentAt)
    this.chatbot.scrollDown({ force: true })

    this.save(trimmedValue)

    return true
  }

  save(value = this._input.value) {
    let val = value

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
    setTimeout(() => {
      // Remove the last character to avoid the space
      this._input.value = this._input.value.slice(0, -1)
    }, 0)
  }

  enableVoiceMode() {
    if (!this._isVoiceModeEnabled) {
      this._isVoiceModeEnabled = true

      const body = document.querySelector('body')
      if (!body.classList.contains('voice-mode-enabled')) {
        body.classList.add('voice-mode-enabled')

        const voiceOverlayTransitor = document.createElement('div')
        voiceOverlayTransitor.id = 'voice-overlay-transitor'
        body.appendChild(voiceOverlayTransitor)
        voiceOverlayTransitor.addEventListener('animationend', () => {
          voiceOverlayTransitor.removeEventListener('animationend', () => {})
          voiceOverlayTransitor.remove()
        })
      }
    }
  }
  disableVoiceMode() {
    if (this._isVoiceModeEnabled) {
      this._isVoiceModeEnabled = false

      const body = document.querySelector('body')

      const voiceContainer = document.querySelector('#voice-container')
      if (voiceContainer) {
        voiceContainer.style.animation = 'none'
        voiceContainer.style.animation = null
      }

      if (body.classList.contains('voice-mode-enabled')) {
        body.classList.remove('voice-mode-enabled')
      }
    }
  }
}

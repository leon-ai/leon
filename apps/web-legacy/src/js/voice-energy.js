const STATUS = {
  listening: 'Listening...',
  processing: 'Processing...',
  talking: 'Talking...',
  idle: 'Idle'
}

export default class VoiceEnergy {
  constructor(client) {
    this.client = client
    this.voiceEnergyContainerElement = document.querySelector(
      '#voice-energy-container'
    )
    this.voiceOverlayElement = document.querySelector('#voice-overlay-bg')
    this.statusElement = document.querySelector('#voice-status')
    this._status = 'idle'
  }

  get status() {
    return this._status
  }

  set status(newStatus) {
    if (this._status !== newStatus) {
      this._status = newStatus

      if (this.statusElement) {
        this.statusElement.textContent = STATUS[newStatus]
      }

      // Clean up speech text when listening
      if (newStatus === 'listening' && this.client.voiceSpeechElement) {
        this.client.voiceSpeechElement.textContent = ''
      }

      if (this.voiceEnergyContainerElement) {
        this.voiceEnergyContainerElement.className = ''
        this.voiceEnergyContainerElement.classList.add(newStatus)
      }
    }
  }

  init() {
    if (this.voiceEnergyContainerElement) {
      if (this.voiceOverlayElement) {
        this.voiceOverlayElement.addEventListener('click', (e) => {
          e.preventDefault()
          this.client.disableVoiceMode()
        })
      }

      const particles = new Set()
      const particleColors = ['blue', 'pink']

      for (let i = 0; i < 32; i += 1) {
        const particle = document.createElement('div')
        const randomColor = Math.floor(Math.random() * 2)
        let random = Math.floor(Math.random() * 32)

        while (particles.has(random)) {
          random = Math.floor(Math.random() * 32)
        }

        particles.add(random)
        particle.setAttribute('data-particle', String(random))
        particle.classList.add('voice-particle', particleColors[randomColor])
        particle.style.transform = `rotate(${
          i * 11.25
        }deg) translate(110px) rotate(-${i * 11.25}deg)`
        this.voiceEnergyContainerElement.appendChild(particle)
      }
    }
  }
}

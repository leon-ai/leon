import on from '../sounds/on.mp3'
import off from '../sounds/off.mp3'

export default class Recorder {
  constructor(stream, el, info) {
    this.recorder = new MediaRecorder(stream, { audioBitsPerSecond: 16000 })
    this.el = el
    this.audioOn = new Audio(on)
    this.audioOff = new Audio(off)
    this.playSound = true
    this.info = info
    this.enabled = false
    this.hotwordTriggered = false
    this.noiseDetected = false
    this.countSilenceAfterTalk = 0
  }

  start(playSound = true) {
    if (this.info.stt.enabled === false) {
      console.warn('Speech-to-text disabled')
    } else {
      this.playSound = playSound
      this.recorder.start(playSound)
    }
  }

  stop(playSound = true) {
    if (this.info.stt.enabled === false) {
      console.warn('Speech-to-text disabled')
    } else {
      this.playSound = playSound
      this.recorder.stop(playSound)
    }
  }

  onstart(cb) {
    this.recorder.onstart = (e) => {
      if (this.playSound) {
        this.audioOn.play()
      }
      this.el.classList.add('enabled')

      cb(e)
    }
  }

  onstop(cb) {
    this.recorder.onstop = (e) => {
      if (this.playSound) {
        this.audioOff.play()
      }
      this.el.classList.remove('enabled')

      cb(e)
    }
  }

  ondataavailable(cb) {
    this.recorder.ondataavailable = (e) => {
      cb(e)
    }
  }
}

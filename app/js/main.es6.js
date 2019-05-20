'use strict'

import request from 'superagent'

import Loader from './loader.es6'
import Client from './client.es6'
import Recorder from './recorder.es6'
import listener from './listener.es6'
import { onkeydowndocument, onkeydowninput } from './onkeydown.es6'

const config = {
  app: 'webapp',
  server_host: process.env.LEON_SERVER_HOST,
  server_port: process.env.LEON_SERVER_PORT,
  min_decibels: -40, // Noise detection sensitivity
  max_blank_time: 1000 // Maximum time to consider a blank (ms)
}

document.addEventListener('DOMContentLoaded', () => {
  const loader = new Loader()

  loader.start()

  request.get(`${config.server_host}:${config.server_port}/v1/info`)
    .end((err, res) => {
      if (err || !res.ok) {
        console.error(err.response.error.message)
      } else {
        const input = document.querySelector('#query')
        const mic = document.querySelector('button')
        const v = document.querySelector('#version small')
        const logger = document.querySelector('#logger small')
        const client = new Client(config.app, config.server_host,
          config.server_port, input, res.body)
        let rec = { }
        let chunks = []
        let enabled = false
        let hotwordTriggered = false
        let autoStartedAfterTalk = false
        let noiseDetected = false
        let countSilenceAfterTalk = 0
        let sLogger = ' enabled, thank you.'

        v.innerHTML += client.info.version
        if (client.info.logger === false) {
          sLogger = ' disabled.'
        }
        logger.innerHTML += sLogger

        client.init(config)

        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
            if (MediaRecorder) {
              rec = new Recorder(stream, mic, client.info)

              rec.ondataavailable((e) => {
                chunks.push(e.data)
              })

              rec.onstart(() => { /* */ })

              rec.onstop(() => {
                const blob = new Blob(chunks)
                chunks = []
                enabled = false

                // Ensure there are some data
                if (blob.size >= 1000) {
                  client.socket.emit('recognize', blob)
                }
              })

              listener.listening(stream, config.min_decibels, config.max_blank_time, () => {
                // Noise detected
                noiseDetected = true
              }, () => {
                // Noise ended

                noiseDetected = false
                if (enabled === true && hotwordTriggered === false) {
                  rec.stop()
                  enabled = false
                  hotwordTriggered = false
                  countSilenceAfterTalk = 0

                  if (client.info.after_speech === true) {
                    // Auto enable recording after talk
                    setTimeout(() => {
                      rec.start(false)
                      enabled = true
                      autoStartedAfterTalk = true
                    }, 500)
                  }
                }
              })

              if (client.info.after_speech === true) {
                setInterval(() => {
                  // If record after talk has started
                  if (autoStartedAfterTalk === true && countSilenceAfterTalk <= 3) {
                    // Stop recording if there was no noise for 3 seconds
                    if (countSilenceAfterTalk === 3) {
                      rec.stop(false)
                      enabled = false
                      autoStartedAfterTalk = false
                      countSilenceAfterTalk = 0
                    } else if (noiseDetected === false) {
                      countSilenceAfterTalk += 1
                    }
                  }
                }, 1000)
              }

              client.socket.on('enable-record', () => {
                hotwordTriggered = true
                rec.start()
                setTimeout(() => { hotwordTriggered = false }, config.max_blank_time)
                enabled = true
              })
            } else {
              console.error('MediaRecorder is not supported on your browser.')
            }
          }).catch((err) => {
            console.error('MediaDevices.getUserMedia() threw the following error:', err)
          })
        } else {
          console.error('MediaDevices.getUserMedia() is not supported on your browser.')
        }

        loader.stop()

        document.addEventListener('keydown', (e) => {
          onkeydowndocument(e, () => {
            if (enabled === false) {
              input.value = ''
              rec.start()
              enabled = true
            } else {
              rec.stop()
              enabled = false
            }
          })
        })

        input.addEventListener('keydown', (e) => {
          onkeydowninput(e, client)
        })

        mic.addEventListener('click', (e) => {
          e.preventDefault()

          if (enabled === false) {
            rec.start()
            enabled = true
          } else {
            rec.stop()
            enabled = false
          }
        })
      }
    })
})

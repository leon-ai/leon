import axios from 'axios'
import '@aurora/style.css'

window.leonInitStatusEvent = new EventTarget()

import './init'
import Client from './client'
import { BuiltInCommands } from './built-in-commands'
import FileSystemAutocomplete from './file-system-autocomplete'
import SessionsPanel from './sessions'
// import Recorder from './recorder'
// import listener from './listener'
import { onkeydownstartrecording, onkeydowninput } from './onkeydown'

const config = {
  app: 'webapp',
  server_host: import.meta.env.VITE_LEON_HOST,
  server_port: import.meta.env.VITE_LEON_PORT,
  min_decibels: -40, // Noise detection sensitivity
  max_blank_time: 1_000 // Maximum time to consider a blank (ms)
}
const serverUrl =
  import.meta.env.VITE_LEON_NODE_ENV === 'production'
    ? ''
    : `${config.server_host}:${config.server_port}`

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [response, sessionsResponse] = await Promise.all([
      axios.get(`${serverUrl}/api/v1/info`),
      axios.get(`${serverUrl}/api/v1/sessions`)
    ])
    const input = document.querySelector('#utterance')
    const mic = document.querySelector('#mic-button')
    const v = document.querySelector('#version small')
    const infoButton = document.querySelector('#info')
    const client = new Client(config.app, serverUrl, input, {
      activeSessionId: sessionsResponse.data.active_session_id
    })
    const sessionsPanel = new SessionsPanel({
      serverUrl,
      socket: client.socket,
      activeSessionId: sessionsResponse.data.active_session_id,
      initialPayload: sessionsResponse.data,
      onSelect: (sessionId) => client.setActiveSession(sessionId)
    })
    const fileSystemAutocomplete = new FileSystemAutocomplete({
      serverUrl,
      input
    })
    const builtInCommands = new BuiltInCommands({
      serverUrl,
      input,
      getActiveSessionId: () => sessionsPanel.getActiveSessionId(),
      onCommandExecuted: (commandInput) => {
        if (commandInput.trim().startsWith('/session')) {
          void sessionsPanel.refresh()
        }
      },
      onSubmitToChat: (clientAction) => {
        return client.sendUtterance(clientAction.utterance, {
          commandContext: {
            forcedRoutingMode: clientAction.command_context?.forced_routing_mode,
            forcedSkillName: clientAction.command_context?.forced_skill_name,
            forcedToolName: clientAction.command_context?.forced_tool_name
          }
        })
      }
    })
    // let rec = {}
    // let chunks = []

    window.leonConfigInfo = response.data
    const infoKeys = [
      'timeZone',
      'telemetry',
      'gpu',
      'graphicsComputeAPI',
      'totalVRAM',
      'freeVRAM',
      'usedVRAM',
      'llm',
      'stt',
      'tts',
      'mood',
      'version'
    ]
    const infoToDisplay = {}
    infoKeys.forEach((key) => {
      infoToDisplay[key] = window.leonConfigInfo[key]
    })

    v.textContent += window.leonConfigInfo.version

    client.updateMood(window.leonConfigInfo.mood)
    client.setSessionPanel(sessionsPanel)
    sessionsPanel.init()
    client.init()
    fileSystemAutocomplete.attach(input)
    builtInCommands.init()

    infoButton.addEventListener('click', () => {
      alert(JSON.stringify(infoToDisplay, null, 2))
    })

    /*if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          if (MediaRecorder) {
            rec = new Recorder(stream, mic, window.leonConfigInfo)
            client.recorder = rec

            rec.ondataavailable((e) => {
              chunks.push(e.data)
            })

            rec.onstart(() => {
              /!* *!/
            })

            rec.onstop(() => {
              const blob = new Blob(chunks)
              chunks = []
              rec.enabled = false

              // Ensure there are some data
              if (blob.size >= 1_000) {
                client.socket.emit('recognize', blob)
              }
            })

            listener.listening(
              stream,
              config.min_decibels,
              config.max_blank_time,
              () => {
                // Noise detected
                rec.noiseDetected = true
              },
              () => {
                // Noise ended

                rec.noiseDetected = false
                if (rec.enabled && !rec.hotwordTriggered) {
                  rec.stop()
                  rec.enabled = false
                  rec.hotwordTriggered = false
                  rec.countSilenceAfterTalk = 0
                }
              }
            )

            client.socket.on('enable-record', () => {
              rec.hotwordTriggered = true
              rec.start()
              setTimeout(() => {
                rec.hotwordTriggered = false
              }, config.max_blank_time)
              rec.enabled = true
            })
          } else {
            console.error('MediaRecorder is not supported on your browser.')
          }
        })
        .catch((err) => {
          console.error(
            'MediaDevices.getUserMedia() threw the following error:',
            err
          )
        })
    } else {
      console.error(
        'MediaDevices.getUserMedia() is not supported on your browser.'
      )
    }*/

    document.addEventListener('keydown', (e) => {
      onkeydownstartrecording(e, () => {
        client.asrStartRecording()
        /*if (rec.enabled === false) {
          input.value = ''
          rec.start()
          rec.enabled = true
        } else {
          rec.stop()
          rec.enabled = false
        }*/
      })
    })

    input.addEventListener('keydown', (e) => {
      onkeydowninput(e, client)
    })

    mic.addEventListener('click', (e) => {
      e.preventDefault()

      client.asrStartRecording()

      /*if (rec.enabled === false) {
        rec.start()
        rec.enabled = true
      } else {
        rec.stop()
        rec.enabled = false
      }*/
    })
  } catch (e) {
    alert(`Error: ${e.message}; ${JSON.stringify(e.response?.data)}`)
    console.error(e)
  }
})

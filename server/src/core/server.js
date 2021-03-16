import express from 'express'
import http from 'http'
import bodyParser from 'body-parser'
import socketio from 'socket.io'
import path from 'path'

import { version } from '@@/package.json'
import { langs } from '@@/core/langs.json'
import Nlu from '@/core/nlu'
import Brain from '@/core/brain'
import Asr from '@/core/asr'
import Stt from '@/stt/stt'
import corsMidd from '@/middleware/cors'
import otherMidd from '@/middleware/other'
import infoRouter from '@/api/info/info.routes'
import downloadRouter from '@/api/downloads/download.routes'
import log from '@/helpers/log'
import date from '@/helpers/date'

const app = express()
let stt = { }

class Server {
  constructor () {
    this.server = { }
  }

  /**
   * Server entry point
   */
  static init () {
    return new Promise(async (resolve) => {
      // CORS middleware
      app.use(corsMidd)

      // A simple middleware
      app.use(otherMidd)

      app.use(bodyParser.json())
      app.use(bodyParser.urlencoded({
        extended: true
      }))

      log.title('Initialization')
      log.success(`The current env is ${process.env.LEON_NODE_ENV}`)
      log.success(`The current version is ${version}`)

      if (!Object.keys(langs).includes(process.env.LEON_LANG) === true) {
        process.env.LEON_LANG = 'en-US'

        log.warning('The language you chose is not supported, then the default language has been applied')
      }

      log.success(`The current language is ${process.env.LEON_LANG}`)
      log.success(`The current time zone is ${date.timeZone()}`)

      const sLogger = (process.env.LEON_LOGGER !== 'true') ? 'disabled' : 'enabled'
      log.success(`Collaborative logger ${sLogger}`)

      await this.bootstrap()
      resolve()
    })
  }

  /**
   * Bootstrap API
   */
  static bootstrap () {
    return new Promise(async (resolve) => {
      const apiVersion = 'v1'

      // Render the web app
      app.use(express.static(`${__dirname}/../../../app/dist`))
      app.get('/', (req, res) => {
        res.sendFile(path.resolve(`${__dirname}/../../../app/dist/index.html`))
      })

      app.use(`/${apiVersion}/info`, infoRouter)
      app.use(`/${apiVersion}/downloads`, downloadRouter)

      try {
        this.server = http.createServer(app)

        await this.listen(process.env.LEON_PORT)
        resolve()
      } catch (e) {
        log[e.type](e.obj.message)
      }
    })
  }

  /**
   * Launch server
   */
  static listen (port) {
    return new Promise((resolve, reject) => {
      const io = process.env.LEON_NODE_ENV === 'development'
        ? socketio(this.server, { cors: { origin: `${process.env.LEON_HOST}:3000` } })
        : socketio(this.server)

      io.on('connection', this.connection)

      this.server.listen(port, (err) => {
        /* istanbul ignore if */
        if (err) {
          reject({ type: 'error', obj: err })
          return
        }

        log.success(`Server is available at ${process.env.LEON_HOST}:${port}`)

        resolve()
      })
    })
  }

  /**
   * Bootstrap socket
   */
  static connection (socket) {
    return new Promise((resolve) => {
      log.title('Client')
      log.success('Connected')

      // Init
      socket.on('init', async (data) => {
        log.info(`Type: ${data}`)
        log.info(`Socket id: ${socket.id}`)

        if (data === 'hotword-node') {
          // Hotword triggered
          socket.on('hotword-detected', (data) => {
            log.title('Socket')
            log.success(`Hotword ${data.hotword} detected`)

            socket.broadcast.emit('enable-record')
          })
        } else {
          const brain = new Brain(socket, langs[process.env.LEON_LANG].short)
          const nlu = new Nlu(brain)
          const asr = new Asr()
          let sttState = 'disabled'
          let ttsState = 'disabled'

          if (process.env.LEON_STT === 'true') {
            sttState = 'enabled'

            stt = new Stt(socket, process.env.LEON_STT_PROVIDER)
            stt.init()
          }
          if (process.env.LEON_TTS === 'true') {
            ttsState = 'enabled'
          }

          log.title('Initialization')
          log.success(`STT ${sttState}`)
          log.success(`TTS ${ttsState}`)

          // Train modules expressions
          try {
            await nlu.loadModel(`${__dirname}/../data/expressions/classifier.json`)
          } catch (e) {
            log[e.type](e.obj.message)
          }

          // Listen for new query
          socket.on('query', async (data) => {
            log.title('Socket')
            log.info(`${data.client} emitted: ${data.value}`)

            socket.emit('is-typing', true)
            await nlu.process(data.value)
          })

          // Handle automatic speech recognition
          socket.on('recognize', async (data) => {
            try {
              await asr.run(data, stt)
            } catch (e) {
              log[e.type](e.obj.message)
            }
          })
        }

        resolve()
      })
    })
  }
}

export default Server

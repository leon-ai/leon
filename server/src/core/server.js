import Fastify from 'fastify'
import fastifyStatic from 'fastify-static'
import socketio from 'socket.io'
import { join } from 'path'

import { version } from '@@/package.json'
import { langs } from '@@/core/langs.json'
import Nlu from '@/core/nlu'
import Brain from '@/core/brain'
import Asr from '@/core/asr'
import Stt from '@/stt/stt'
import corsMidd from '@/plugins/cors'
import otherMidd from '@/plugins/other'
import infoPlugin from '@/api/info/index'
import downloadsPlugin from '@/api/downloads/index'
import log from '@/helpers/log'
import date from '@/helpers/date'

class Server {
  constructor () {
    this.fastify = Fastify()
    this.httpServer = { }
    this.brain = { }
    this.nlu = { }
    this.asr = { }
    this.stt = { }
  }

  /**
   * Server entry point
   */
  async init () {
    this.fastify.addHook('onRequest', corsMidd)
    this.fastify.addHook('onRequest', otherMidd)

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
  }

  /**
   * Bootstrap API
   */
  async bootstrap () {
    const apiVersion = 'v1'

    // Render the web app
    this.fastify.register(fastifyStatic, {
      root: join(__dirname, '..', '..', '..', 'app', 'dist'),
      prefix: '/'
    })
    this.fastify.get('/', (_request, reply) => {
      reply.sendFile('index.html')
    })

    this.fastify.register(infoPlugin, { apiVersion })
    this.fastify.register(downloadsPlugin, { apiVersion })

    this.httpServer = this.fastify.server

    try {
      await this.listen(process.env.LEON_PORT)
    } catch (e) {
      log.error(e.message)
    }
  }

  /**
   * Launch server
   */
  async listen (port) {
    const io = process.env.LEON_NODE_ENV === 'development'
      ? socketio(this.httpServer, { cors: { origin: `${process.env.LEON_HOST}:3000` } })
      : socketio(this.httpServer)

    io.on('connection', this.connection)

    await this.fastify.listen(port, '0.0.0.0')
    log.success(`Server is available at ${process.env.LEON_HOST}:${port}`)
  }

  /**
   * Bootstrap socket
   */
  async connection (socket) {
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
        let sttState = 'disabled'
        let ttsState = 'disabled'

        this.brain = new Brain(socket, langs[process.env.LEON_LANG].short)
        this.nlu = new Nlu(this.brain)
        this.asr = new Asr()

        /* istanbul ignore if */
        if (process.env.LEON_STT === 'true') {
          sttState = 'enabled'

          this.stt = new Stt(socket, process.env.LEON_STT_PROVIDER)
          this.stt.init()
        }

        if (process.env.LEON_TTS === 'true') {
          ttsState = 'enabled'
        }

        log.title('Initialization')
        log.success(`STT ${sttState}`)
        log.success(`TTS ${ttsState}`)

        // Train modules expressions
        try {
          await this.nlu.loadModel(join(__dirname, '../data/leon-model.nlp'))
        } catch (e) {
          log[e.type](e.obj.message)
        }

        // Listen for new query
        socket.on('query', async (data) => {
          log.title('Socket')
          log.info(`${data.client} emitted: ${data.value}`)

          socket.emit('is-typing', true)
          await this.nlu.process(data.value)
        })

        // Handle automatic speech recognition
        socket.on('recognize', async (data) => {
          try {
            await this.asr.run(data, this.stt)
          } catch (e) {
            log[e.type](e.obj.message)
          }
        })
      }
    })
  }
}

export default Server

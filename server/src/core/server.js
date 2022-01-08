import Fastify from 'fastify'
import fastifyStatic from 'fastify-static'
import socketio from 'socket.io'
import { join } from 'path'

import { version } from '@@/package.json'
import { langs } from '@@/core/langs.json'
import { endpoints } from '@@/core/pkgs-endpoints.json'
import Nlu from '@/core/nlu'
import Brain from '@/core/brain'
import Asr from '@/core/asr'
import Stt from '@/stt/stt'
import Tts from '@/tts/tts'
import corsMidd from '@/plugins/cors'
import otherMidd from '@/plugins/other'
import infoPlugin from '@/api/info/index'
import downloadsPlugin from '@/api/downloads/index'
import log from '@/helpers/log'
import date from '@/helpers/date'

const server = { }
const fastify = Fastify()
let brain = { }
let httpServer = { }

/**
 * Bootstrap socket
 */
const handleOnConnection = (socket) => {
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

      brain = new Brain(socket, langs[process.env.LEON_LANG].short)
      const nlu = new Nlu(brain)
      const asr = new Asr()
      let stt = { }
      let tts = { }

      /* istanbul ignore if */
      if (process.env.LEON_STT === 'true') {
        sttState = 'enabled'

        stt = new Stt(socket, process.env.LEON_STT_PROVIDER)
        stt.init(() => null)
      }

      if (process.env.LEON_TTS === 'true') {
        ttsState = 'enabled'

        tts = new Tts(socket, process.env.LEON_TTS_PROVIDER)
        tts.init((ttsInstance) => {
          brain.tts = ttsInstance
        })
      }

      log.title('Initialization')
      log.success(`STT ${sttState}`)
      log.success(`TTS ${ttsState}`)

      // Train modules expressions
      try {
        await nlu.loadModel(join(__dirname, '../data/leon-model.nlp'))
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
  })
}

/**
 * Launch server
 */
const listen = async (port) => {
  const io = process.env.LEON_NODE_ENV === 'development'
    ? socketio(httpServer, { cors: { origin: `${process.env.LEON_HOST}:3000` } })
    : socketio(httpServer)

  io.on('connection', handleOnConnection)

  await fastify.listen(port, '0.0.0.0')
  log.success(`Server is available at ${process.env.LEON_HOST}:${port}`)
}

/**
 * Bootstrap API
 */
const bootstrap = async () => {
  const apiVersion = 'v1'

  // Render the web app
  fastify.register(fastifyStatic, {
    root: join(__dirname, '..', '..', '..', 'app', 'dist'),
    prefix: '/'
  })
  fastify.get('/', (_request, reply) => {
    reply.sendFile('index.html')
  })

  fastify.register(infoPlugin, { apiVersion })
  fastify.register(downloadsPlugin, { apiVersion })

  if (process.env.PACKAGES_OVER_HTTP === 'true') {
    // Dynamically expose Leon modules over HTTP
    endpoints.forEach((endpoint) => {
      fastify.route({
        method: endpoint.method,
        url: endpoint.route,
        async handler (request, reply) {
          const [, , pkg, module, action] = endpoint.route.split('/')
          const { params } = endpoint
          const entities = []

          params.forEach((param) => {
            const value = request.body[param]

            // TODO: be able to handle "url": [] from entity params

            let entity = {
              entity: param,
              sourceText: value,
              utteranceText: value,
              resolution: { value }
            }

            if (Array.isArray(value)) {
              value.forEach((v) => {
                entity = {
                  entity: param,
                  sourceText: v,
                  utteranceText: v,
                  resolution: { v }
                }

                entities.push(entity)
              })
            } else {
              entities.push(entity)
            }
          })

          const obj = {
            query: '',
            entities,
            classification: {
              package: pkg,
              module,
              action,
              confidence: 1
            }
          }
          const responseData = {
            package: pkg,
            module,
            action,
            execution_time: 0, // ms
            speeches: []
          }

          try {
            // Inject action entities with the others if there is
            const { speeches, executionTime } = await brain.execute(obj, { mute: true })

            reply.send({
              ...responseData,
              entities,
              speeches,
              execution_time: executionTime,
              success: true
            })
          } catch (e) /* istanbul ignore next */ {
            log[e.type](e.obj.message)
            reply.statusCode = 500
            reply.send({
              ...responseData,
              speeches: e.speeches,
              execution_time: e.executionTime,
              error: e.obj.message,
              success: false
            })
          }
        }
      })
    })
  }

  httpServer = fastify.server

  try {
    await listen(process.env.LEON_PORT)
  } catch (e) {
    log.error(e.message)
  }
}

/**
 * Server entry point
 */
server.init = async () => {
  fastify.addHook('onRequest', corsMidd)
  fastify.addHook('onRequest', otherMidd)

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

  await bootstrap()
}

export default server

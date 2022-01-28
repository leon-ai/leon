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
import corsMidd from '@/core/http-server/plugins/cors'
import otherMidd from '@/core/http-server/plugins/other'
import keyMidd from '@/core/http-server/plugins/key'
import infoPlugin from '@/core/http-server/api/info'
import downloadsPlugin from '@/core/http-server/api/downloads'
import log from '@/helpers/log'
import date from '@/helpers/date'

const server = { }
const fastify = Fastify()
let brain = { }
let nlu = { }
let httpServer = { }

/**
 * Generate packages routes
 */
const generatePackagesRoutes = (instance) => {
  // Dynamically expose Leon modules over HTTP
  endpoints.forEach((endpoint) => {
    instance.route({
      method: endpoint.method,
      url: endpoint.route,
      async handler (request, reply) {
        const timeout = endpoint.timeout || 60000
        const [, , , pkg, module, action] = endpoint.route.split('/')
        const handleRoute = async () => {
          const { params } = endpoint
          const entities = []

          params.forEach((param) => {
            const value = request.body[param]
            const trimEntity = {
              entity: param,
              sourceText: value,
              utteranceText: value,
              resolution: { value }
            }
            const builtInEntity = {
              entity: param,
              resolution: { ...value }
            }
            let entity = endpoint?.entitiesType === 'trim' ? trimEntity : builtInEntity

            if (Array.isArray(value)) {
              value.forEach((v) => {
                entity = {
                  entity: param,
                  resolution: { ...v }
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
            speeches: []
          }

          try {
            const data = await brain.execute(obj, { mute: true })

            reply.send({
              ...data,
              success: true
            })
          } catch (e) /* istanbul ignore next */ {
            log[e.type](e.obj.message)
            reply.statusCode = 500
            reply.send({
              ...responseData,
              speeches: e.speeches,
              executionTime: e.executionTime,
              message: e.obj.message,
              success: false
            })
          }
        }

        handleRoute()
        setTimeout(() => {
          reply.statusCode = 408
          reply.send({
            package: pkg,
            module,
            action,
            message: 'The action has timed out',
            timeout,
            success: false
          })
        }, timeout)
      }
    })
  })
}

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
      const asr = new Asr()
      let stt = { }
      let tts = { }
      let sttState = 'disabled'
      let ttsState = 'disabled'

      brain.socket = socket

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
    root: join(__dirname, '../../../../app/dist'),
    prefix: '/'
  })
  fastify.get('/', (request, reply) => {
    reply.sendFile('index.html')
  })

  fastify.register(infoPlugin, { apiVersion })
  fastify.register(downloadsPlugin, { apiVersion })

  fastify.register((instance, opts, next) => {
    instance.addHook('preHandler', keyMidd)

    instance.post('/core/query', async (request, reply) => {
      const { query } = request.body

      try {
        const data = await nlu.process(query, { mute: true })

        reply.send({
          ...data,
          success: true
        })
      } catch (e) {
        reply.statusCode = 500
        reply.send({
          message: e.message,
          success: false
        })
      }
    })

    if (process.env.LEON_PACKAGES_OVER_HTTP === 'true') {
      generatePackagesRoutes(instance)
    }

    next()
  })

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
  fastify.addHook('preValidation', otherMidd)

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

  brain = new Brain(langs[process.env.LEON_LANG].short)
  nlu = new Nlu(brain)

  // Train modules expressions
  try {
    await nlu.loadModel(join(__dirname, '../../data/leon-model.nlp'))
  } catch (e) {
    log[e.type](e.obj.message)
  }

  await bootstrap()
}

export default server

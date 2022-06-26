import Fastify from 'fastify'
import fastifyStatic from 'fastify-static'
import socketio from 'socket.io'
import { join } from 'path'

import { version } from '@@/package.json'
import { endpoints } from '@@/core/skills-endpoints.json'
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
let brain = { }
let nlu = { }

server.fastify = Fastify()
server.httpServer = { }

/**
 * Generate skills routes
 */
/* istanbul ignore next */
server.generateSkillsRoutes = (instance) => {
  // Dynamically expose Leon skills over HTTP
  endpoints.forEach((endpoint) => {
    instance.route({
      method: endpoint.method,
      url: endpoint.route,
      async handler (request, reply) {
        const timeout = endpoint.timeout || 60000
        const [, , , domain, skill, action] = endpoint.route.split('/')
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
            utterance: '',
            entities,
            classification: {
              domain,
              skill,
              action,
              confidence: 1
            }
          }
          const responseData = {
            domain,
            skill,
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
            domain,
            skill,
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
server.handleOnConnection = (socket) => {
  log.title('Client')
  log.success('Connected')

  // Init
  socket.on('init', async (data) => {
    log.info(`Type: ${data}`)
    log.info(`Socket id: ${socket.id}`)

    // Check whether the TCP client is connected to the TCP server
    if (global.tcpClient.isConnected) {
      socket.emit('ready')
    } else {
      global.tcpClient.ee.on('connected', () => {
        socket.emit('ready')
      })
    }

    if (data === 'hotword-node') {
      // Hotword triggered
      socket.on('hotword-detected', (data) => {
        log.title('Socket')
        log.success(`Hotword ${data.hotword} detected`)

        socket.broadcast.emit('enable-record')
      })
    } else {
      const asr = new Asr()
      let sttState = 'disabled'
      let ttsState = 'disabled'

      brain.socket = socket

      /* istanbul ignore if */
      if (process.env.LEON_STT === 'true') {
        sttState = 'enabled'

        brain.stt = new Stt(socket, process.env.LEON_STT_PROVIDER)
        brain.stt.init(() => null)
      }
      if (process.env.LEON_TTS === 'true') {
        ttsState = 'enabled'

        brain.tts = new Tts(socket, process.env.LEON_TTS_PROVIDER)
        brain.tts.init('en', () => null)
      }

      log.title('Initialization')
      log.success(`STT ${sttState}`)
      log.success(`TTS ${ttsState}`)

      // Listen for new utterance
      socket.on('utterance', async (data) => {
        log.title('Socket')
        log.info(`${data.client} emitted: ${data.value}`)

        socket.emit('is-typing', true)

        const utterance = data.value
        try {
          await nlu.process(utterance)
        } catch (e) { /* */ }
      })

      // Handle automatic speech recognition
      socket.on('recognize', async (data) => {
        try {
          await asr.run(data, brain.stt)
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
server.listen = async (port) => {
  const io = process.env.LEON_NODE_ENV === 'development'
    ? socketio(server.httpServer, { cors: { origin: `${process.env.LEON_HOST}:3000` } })
    : socketio(server.httpServer)

  io.on('connection', server.handleOnConnection)

  await server.fastify.listen(port, '0.0.0.0')
  log.title('Initialization')
  log.success(`Server is available at ${process.env.LEON_HOST}:${port}`)
}

/**
 * Bootstrap API
 */
server.bootstrap = async () => {
  const apiVersion = 'v1'

  // Render the web app
  server.fastify.register(fastifyStatic, {
    root: join(process.cwd(), 'app/dist'),
    prefix: '/'
  })
  server.fastify.get('/', (request, reply) => {
    reply.sendFile('index.html')
  })

  server.fastify.register(infoPlugin, { apiVersion })
  server.fastify.register(downloadsPlugin, { apiVersion })

  if (process.env.LEON_OVER_HTTP === 'true') {
    server.fastify.register((instance, opts, next) => {
      instance.addHook('preHandler', keyMidd)

      instance.post('/api/query', async (request, reply) => {
        const { utterance } = request.body

        try {
          const data = await nlu.process(utterance, { mute: true })

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

      server.generateSkillsRoutes(instance)

      next()
    })
  }

  server.httpServer = server.fastify.server

  try {
    await server.listen(process.env.LEON_PORT)
  } catch (e) {
    log.error(e.message)
  }
}

/**
 * Server entry point
 */
server.init = async () => {
  server.fastify.addHook('onRequest', corsMidd)
  server.fastify.addHook('preValidation', otherMidd)

  log.title('Initialization')
  log.success(`The current env is ${process.env.LEON_NODE_ENV}`)
  log.success(`The current version is ${version}`)

  log.success(`The current time zone is ${date.timeZone()}`)

  const sLogger = (process.env.LEON_LOGGER !== 'true') ? 'disabled' : 'enabled'
  log.success(`Collaborative logger ${sLogger}`)

  brain = new Brain()

  nlu = new Nlu(brain)

  // Load NLP model
  try {
    await nlu.loadModel(join(process.cwd(), 'core/data/leon-model.nlp'))
  } catch (e) {
    log[e.type](e.obj.message)
  }

  await server.bootstrap()
}

export default server

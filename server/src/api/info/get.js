import { langs } from '@@/core/langs.json'
import { version } from '@@/package.json'
import log from '@/helpers/log'

const getInfo = async (fastify, options) => {
  fastify.get(`/${options.apiVersion}/info`, (_request, reply) => {
    log.title('GET /info')

    const message = 'Information pulled.'

    log.success(message)

    reply.send({
      success: true,
      status: 200,
      code: 'info_pulled',
      message,
      after_speech: process.env.LEON_AFTER_SPEECH === 'true',
      logger: process.env.LEON_LOGGER === 'true',
      stt: {
        enabled: process.env.LEON_STT === 'true',
        provider: process.env.LEON_STT_PROVIDER
      },
      tts: {
        enabled: process.env.LEON_TTS === 'true',
        provider: process.env.LEON_TTS_PROVIDER
      },
      lang: langs[process.env.LEON_LANG],
      version
    })
  })
}

export default getInfo

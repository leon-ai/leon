'use strict'

import { langs } from '@@/core/langs.json'
import { version } from '@@/package.json'
import log from '@/helpers/log'

const infoController = { }

infoController.get = (req, res) => {
  log.title('GET /info')

  const message = 'Information pulled.'

  log.success(message)

  res.json({
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
}

export default infoController

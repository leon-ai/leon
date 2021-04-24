import { command } from 'execa'
import fs from 'fs'

import log from '@/helpers/log'
import os from '@/helpers/os'

/**
 * Setup offline speech-to-text
 */
export default () => new Promise(async (resolve, reject) => {
  log.info('Setting up offline speech-to-text...')

  const destDeepSpeechFolder = 'bin/deepspeech'
  const tmpDir = 'scripts/tmp'
  const deepSpeechVersion = '0.9.3'
  let downloader = 'wget'
  if (os.get().type === 'macos') {
    downloader = 'curl -L -O'
  }

  if (!fs.existsSync(`${destDeepSpeechFolder}/deepspeech.scorer`)) {
    try {
      log.info('Downloading pre-trained model...')
      await command(`cd ${tmpDir} && ${downloader} https://github.com/mozilla/DeepSpeech/releases/download/v${deepSpeechVersion}/deepspeech-${deepSpeechVersion}-models.pbmm`, { shell: true })
      await command(`cd ${tmpDir} && ${downloader} https://github.com/mozilla/DeepSpeech/releases/download/v${deepSpeechVersion}/deepspeech-${deepSpeechVersion}-models.scorer`, { shell: true })
      log.success('Pre-trained model download done')
      log.info('Moving...')
      await command(`mv -f ${tmpDir}/deepspeech-${deepSpeechVersion}-models.pbmm ${destDeepSpeechFolder}/deepspeech.pbmm`, { shell: true })
      await command(`mv -f ${tmpDir}/deepspeech-${deepSpeechVersion}-models.scorer ${destDeepSpeechFolder}/deepspeech.scorer`, { shell: true })
      log.success('Move done')
      log.success('Offline speech-to-text installed')

      resolve()
    } catch (e) {
      log.error(`Failed to install offline speech-to-text: ${e}`)
      reject(e)
    }
  } else {
    log.success('Offline speech-to-text is already installed')
    resolve()
  }
})

import { shell } from 'execa'
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
  const archiveName = 'deepspeech-0.4.1-models.tar.gz'
  let downloader = 'wget'
  if (os.get().type === 'macos') {
    downloader = 'curl -L -O'
  }

  if (!fs.existsSync(`${destDeepSpeechFolder}/lm.binary`)) {
    try {
      log.info('Downloading pre-trained model...')
      await shell(`cd ${tmpDir} && ${downloader} https://github.com/mozilla/DeepSpeech/releases/download/v0.4.1/${archiveName}`)
      log.success('Pre-trained model download done')
      log.info('Unpacking...')
      await shell(`cd ${tmpDir} && tar xvfz ${archiveName}`)
      log.success('Unpack done')
      log.info('Moving...')
      await shell(`mv -f ${tmpDir}/models/* ${destDeepSpeechFolder} && rm -rf ${tmpDir}/${archiveName} ${tmpDir}/models`)
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

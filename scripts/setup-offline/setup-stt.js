import { command } from 'execa'
import fs from 'fs'

import { log } from '@/helpers/log'
import { getOSInformation } from '@/helpers/os'

/**
 * Setup offline speech-to-text
 */
export default () =>
  new Promise(async (resolve, reject) => {
    log.info('Setting up offline speech-to-text...')

    const destCoquiFolder = 'bin/coqui'
    const tmpDir = 'scripts/tmp'
    // check this repo for updates: https://github.com/coqui-ai/STT-models/tree/main/english/coqui
    const coquiModelVersion = '1.0.0'
    let downloader = 'wget'
    if (getOSInformation().type === 'macos') {
      downloader = 'curl -L -O'
    }

    if (!fs.existsSync(`${destCoquiFolder}/model.tflite`)) {
      try {
        log.info('Downloading pre-trained model...')
        await command(
          `cd ${tmpDir} && ${downloader} https://github.com/coqui-ai/STT-models/releases/download/english/coqui/v${coquiModelVersion}-huge-vocab/model.tflite`,
          { shell: true }
        )
        await command(
          `cd ${tmpDir} && ${downloader} https://github.com/coqui-ai/STT-models/releases/download/english/coqui/v${coquiModelVersion}-huge-vocab/huge-vocabulary.scorer`,
          { shell: true }
        )
        log.success('Pre-trained model download done')
        log.info('Moving...')
        await command(
          `mv -f ${tmpDir}/model.tflite ${destCoquiFolder}/model.tflite`,
          { shell: true }
        )
        await command(
          `mv -f ${tmpDir}/huge-vocabulary.scorer ${destCoquiFolder}/huge-vocabulary.scorer`,
          { shell: true }
        )
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

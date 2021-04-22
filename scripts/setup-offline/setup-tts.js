import { command } from 'execa'
import fs from 'fs'

import log from '@/helpers/log'
import os from '@/helpers/os'

/**
 * Setup offline text-to-speech
 */
export default () => new Promise(async (resolve, reject) => {
  log.info('Setting up offline text-to-speech...')

  const destFliteFolder = 'bin/flite'
  const tmpDir = 'scripts/tmp'
  let makeCores = ''
  if (os.cpus().length > 2) {
    makeCores = `-j ${os.cpus().length - 2}`
  }
  let downloader = 'wget'
  if (os.get().type === 'macos') {
    downloader = 'curl -L -O'
  }

  if (!fs.existsSync(`${destFliteFolder}/flite`)) {
    try {
      log.info('Downloading run-time synthesis engine...')
      await command(`cd ${tmpDir} && ${downloader} http://www.festvox.org/flite/packed/flite-2.1/flite-2.1-release.tar.bz2`, { shell: true })
      log.success('Run-time synthesis engine download done')
      log.info('Unpacking...')
      await command(`cd ${tmpDir} && tar xfvj flite-2.1-release.tar.bz2 && cp ../assets/leon.lv flite-2.1-release/config`, { shell: true })
      log.success('Unpack done')
      log.info('Configuring...')
      await command(`cd ${tmpDir}/flite-2.1-release && ./configure --with-langvox=leon`, { shell: true })
      log.success('Configure done')
      log.info('Building...')
      await command(`cd ${tmpDir}/flite-2.1-release && make ${makeCores}`, { shell: true })
      log.success('Build done')
      log.info('Cleaning...')
      await command(`cp -f ${tmpDir}/flite-2.1-release/bin/flite ${destFliteFolder} && rm -rf ${tmpDir}/flite-2.1-release*`, { shell: true })
      log.success('Clean done')
      log.success('Offline text-to-speech installed')

      resolve()
    } catch (e) {
      log.error(`Failed to install offline text-to-speech: ${e}`)
      reject(e)
    }
  } else {
    log.success('Offline text-to-speech is already installed')
    resolve()
  }
})

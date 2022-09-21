import { command } from 'execa'
import fs from 'fs'

import { LOG } from '@/helpers/log'
import { OS } from '@/helpers/os'

/**
 * Setup offline text-to-speech
 */
export default () =>
  new Promise(async (resolve, reject) => {
    LOG.info('Setting up offline text-to-speech...')

    const destFliteFolder = 'bin/flite'
    const tmpDir = 'scripts/tmp'
    let makeCores = ''
    if (OS.getNumberOfCPUCores() > 2) {
      makeCores = `-j ${OS.getNumberOfCPUCores() - 2}`
    }
    let downloader = 'wget'
    if (OS.getInformation().type === 'macos') {
      downloader = 'curl -L -O'
    }

    if (!fs.existsSync(`${destFliteFolder}/flite`)) {
      try {
        LOG.info('Downloading run-time synthesis engine...')
        await command(
          `cd ${tmpDir} && ${downloader} http://ports.ubuntu.com/pool/universe/f/flite/flite_2.1-release.orig.tar.bz2`,
          { shell: true }
        )
        LOG.success('Run-time synthesis engine download done')
        LOG.info('Unpacking...')
        await command(
          `cd ${tmpDir} && tar xfvj flite_2.1-release.orig.tar.bz2 && cp ../assets/leon.lv flite-2.1-release/config`,
          { shell: true }
        )
        LOG.success('Unpack done')
        LOG.info('Configuring...')
        await command(
          `cd ${tmpDir}/flite-2.1-release && ./configure --with-langvox=leon`,
          { shell: true }
        )
        LOG.success('Configure done')
        LOG.info('Building...')
        await command(`cd ${tmpDir}/flite-2.1-release && make ${makeCores}`, {
          shell: true
        })
        LOG.success('Build done')
        LOG.info('Cleaning...')
        await command(
          `cp -f ${tmpDir}/flite-2.1-release/bin/flite ${destFliteFolder} && rm -rf ${tmpDir}/flite-2.1-release*`,
          { shell: true }
        )
        LOG.success('Clean done')
        LOG.success('Offline text-to-speech installed')

        resolve()
      } catch (e) {
        LOG.error(`Failed to install offline text-to-speech: ${e}`)
        reject(e)
      }
    } else {
      LOG.success('Offline text-to-speech is already installed')
      resolve()
    }
  })

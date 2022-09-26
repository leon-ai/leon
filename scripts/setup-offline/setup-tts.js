import fs from 'node:fs'

import { command } from 'execa'

import { LogHelper } from '@/helpers/log-helper'
import { OSHelper } from '@/helpers/os-helper'

/**
 * Setup offline text-to-speech
 */
export default () =>
  new Promise(async (resolve, reject) => {
    LogHelper.info('Setting up offline text-to-speech...')

    const destFliteFolder = 'bin/flite'
    const tmpDir = 'scripts/tmp'
    let makeCores = ''
    if (OSHelper.getNumberOfCPUCores() > 2) {
      makeCores = `-j ${OSHelper.getNumberOfCPUCores() - 2}`
    }
    let downloader = 'wget'
    if (OSHelper.getInformation().type === 'macos') {
      downloader = 'curl -L -O'
    }

    if (!fs.existsSync(`${destFliteFolder}/flite`)) {
      try {
        LogHelper.info('Downloading run-time synthesis engine...')
        await command(
          `cd ${tmpDir} && ${downloader} http://ports.ubuntu.com/pool/universe/f/flite/flite_2.1-release.orig.tar.bz2`,
          { shell: true }
        )
        LogHelper.success('Run-time synthesis engine download done')
        LogHelper.info('Unpacking...')
        await command(
          `cd ${tmpDir} && tar xfvj flite_2.1-release.orig.tar.bz2 && cp ../assets/leon.lv flite-2.1-release/config`,
          { shell: true }
        )
        LogHelper.success('Unpack done')
        LogHelper.info('Configuring...')
        await command(
          `cd ${tmpDir}/flite-2.1-release && ./configure --with-langvox=leon`,
          { shell: true }
        )
        LogHelper.success('Configure done')
        LogHelper.info('Building...')
        await command(`cd ${tmpDir}/flite-2.1-release && make ${makeCores}`, {
          shell: true
        })
        LogHelper.success('Build done')
        LogHelper.info('Cleaning...')
        await command(
          `cp -f ${tmpDir}/flite-2.1-release/bin/flite ${destFliteFolder} && rm -rf ${tmpDir}/flite-2.1-release*`,
          { shell: true }
        )
        LogHelper.success('Clean done')
        LogHelper.success('Offline text-to-speech installed')

        resolve()
      } catch (e) {
        LogHelper.error(`Failed to install offline text-to-speech: ${e}`)
        reject(e)
      }
    } else {
      LogHelper.success('Offline text-to-speech is already installed')
      resolve()
    }
  })

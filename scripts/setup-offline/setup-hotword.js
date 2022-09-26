import { command } from 'execa'

import { LogHelper } from '@/helpers/log-helper'
import { OS } from '@/helpers/os'

/**
 * Setup offline hotword detection
 */
export default () =>
  new Promise(async (resolve, reject) => {
    LogHelper.info('Setting up offline hotword detection...')

    const info = OS.getInformation()
    let pkgm = 'apt-get install'
    if (info.type === 'macos') {
      pkgm = 'brew'
    }

    if (info.type === 'windows') {
      LogHelper.error('Voice offline mode is not available on Windows')
      reject()
    } else {
      try {
        LogHelper.info('Installing dependencies...')

        let cmd = `sudo ${pkgm} sox libsox-fmt-all -y`
        if (info.type === 'linux') {
          LogHelper.info(`Executing the following command: ${cmd}`)
          await command(cmd, { shell: true })
        } else if (info.type === 'macos') {
          cmd = `${pkgm} install swig portaudio sox`
          LogHelper.info(`Executing the following command: ${cmd}`)
          await command(cmd, { shell: true })
        }

        LogHelper.success('System dependencies downloaded')
        LogHelper.info('Installing hotword dependencies...')
        await command('cd hotword && npm install', { shell: true })
        LogHelper.success('Offline hotword detection installed')
        await command(
          'cd hotword/node_modules/@bugsounet/snowboy && CXXFLAGS="--std=c++17" ../../../node_modules/@mapbox/node-pre-gyp/bin/node-pre-gyp clean configure build',
          { shell: true }
        )
        LogHelper.success('Snowboy bindings compiled')

        resolve()
      } catch (e) {
        LogHelper.error(`Failed to install offline hotword detection: ${e}`)
        reject(e)
      }
    }
  })

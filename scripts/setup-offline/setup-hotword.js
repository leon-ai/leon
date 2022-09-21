import { command } from 'execa'

import { LOG } from '@/helpers/log'
import { getOSInformation } from '@/helpers/os'

/**
 * Setup offline hotword detection
 */
export default () =>
  new Promise(async (resolve, reject) => {
    LOG.info('Setting up offline hotword detection...')

    const info = getOSInformation()
    let pkgm = 'apt-get install'
    if (info.type === 'macos') {
      pkgm = 'brew'
    }

    if (info.type === 'windows') {
      LOG.error('Voice offline mode is not available on Windows')
      reject()
    } else {
      try {
        LOG.info('Installing dependencies...')

        let cmd = `sudo ${pkgm} sox libsox-fmt-all -y`
        if (info.type === 'linux') {
          LOG.info(`Executing the following command: ${cmd}`)
          await command(cmd, { shell: true })
        } else if (info.type === 'macos') {
          cmd = `${pkgm} install swig portaudio sox`
          LOG.info(`Executing the following command: ${cmd}`)
          await command(cmd, { shell: true })
        }

        LOG.success('System dependencies downloaded')
        LOG.info('Installing hotword dependencies...')
        await command('cd hotword && npm install', { shell: true })
        LOG.success('Offline hotword detection installed')
        await command(
          'cd hotword/node_modules/@bugsounet/snowboy && CXXFLAGS="--std=c++17" ../../../node_modules/@mapbox/node-pre-gyp/bin/node-pre-gyp clean configure build',
          { shell: true }
        )
        LOG.success('Snowboy bindings compiled')

        resolve()
      } catch (e) {
        LOG.error(`Failed to install offline hotword detection: ${e}`)
        reject(e)
      }
    }
  })

import { command } from 'execa'

import log from '@/helpers/log'
import os from '@/helpers/os'

/**
 * Setup offline hotword detection
 */
export default () => new Promise(async (resolve, reject) => {
  log.info('Setting up offline hotword detection...')

  const info = os.get()
  let pkgm = 'apt-get install'
  if (info.type === 'macos') {
    pkgm = 'brew'
  }

  if (info.type === 'windows') {
    log.error('Voice offline mode is not available on Windows')
    reject()
  } else {
    try {
      log.info('Installing dependencies...')

      let cmd = `sudo ${pkgm} sox libsox-fmt-all -y`
      if (info.type === 'linux') {
        log.info(`Executing the following command: ${cmd}`)
        await command(cmd, { shell: true })
      } else if (info.type === 'macos') {
        cmd = `${pkgm} install swig portaudio sox`
        log.info(`Executing the following command: ${cmd}`)
        await command(cmd, { shell: true })
      }

      log.success('System dependencies downloaded')
      log.info('Installing hotword dependencies...')
      await command('cd hotword && npm install', { shell: true })
      log.success('Offline hotword detection installed')
      await command('cd hotword/node_modules/@bugsounet/snowboy && CXXFLAGS="--std=c++17" ../../../node_modules/@mapbox/node-pre-gyp/bin/node-pre-gyp clean configure build', { shell: true })
      log.success('Snowboy bindings compiled')

      resolve()
    } catch (e) {
      log.error(`Failed to install offline hotword detection: ${e}`)
      reject(e)
    }
  }
})

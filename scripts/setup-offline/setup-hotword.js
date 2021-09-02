import { command } from 'execa'

import log from '@/helpers/log'
import os from '@/helpers/os'

/**
 * Setup offline hotword detection
 */
export default () => new Promise(async (resolve, reject) => {
  log.info('Setting up offline hotword detection...')

  const info = await os.get()
  let pkgm = ''
  if (info.type === 'macos') {
    pkgm = 'brew'
  }
  
  if (info.name === 'Linux') {
    // Add distros as needed
    switch (info.distro) {
      case 'Arch Linux':
        pkgm = 'pacman -S'
        break
      default:
        pkgm = 'apt-get install'
    }
  }

  if (info.type === 'windows') {
    log.error('Voice offline mode is not available on Windows')
    reject()
  } else {
    try {
      log.info('Installing dependencies...')
      let cmd = ''

      if (info.type === 'linux') {
        // Add distros as needed
        switch (info.distro) {
          case 'Arch Linux':
            cmd = `sudo ${pkgm} sox libsoxr`
            break
          default:
            cmd = `sudo ${pkgm} sox libsox-fmt-all -y`
        }

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

      resolve()
    } catch (e) {
      log.error(`Failed to install offline hotword detection: ${e}`)
      reject(e)
    }
  }
})

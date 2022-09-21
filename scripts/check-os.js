import execa from 'execa'

import { LOG } from '@/helpers/log'
import { OS } from '@/helpers/os'

/**
 * Check OS environment
 */
export default () =>
  new Promise(async (resolve, reject) => {
    LOG.info('Checking OS environment...')

    const info = OS.getInformation()

    if (info.type === 'windows') {
      LOG.error('Voice offline mode is not available on Windows')
      reject()
    } else if (info.type === 'unknown') {
      LOG.error(
        'This OS is unknown, please open an issue to let us know about it'
      )
      reject()
    } else {
      try {
        LOG.success(`You are running ${info.name}`)
        LOG.info('Checking tools...')

        await execa('tar', ['--version'])
        LOG.success('"tar" found')
        await execa('make', ['--version'])
        LOG.success('"make" found')

        if (info.type === 'macos') {
          await execa('brew', ['--version'])
          LOG.success('"brew" found')
          await execa('curl', ['--version'])
          LOG.success('"curl" found')
        } else if (info.type === 'linux') {
          await execa('apt-get', ['--version'])
          LOG.success('"apt-get" found')
          await execa('wget', ['--version'])
          LOG.success('"wget" found')
        }

        resolve()
      } catch (e) {
        if (e.cmd) {
          const cmd = e.cmd.substr(0, e.cmd.indexOf(' '))
          LOG.error(
            `The following command has failed: "${e.cmd}". "${cmd}" is maybe missing. To continue this setup, please install the required tool. More details about the failure: ${e}`
          )
        } else {
          LOG.error(`Failed to prepare the environment: ${e}`)
        }

        reject(e)
      }
    }
  })

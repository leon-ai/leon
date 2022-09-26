import execa from 'execa'

import { LogHelper } from '@/helpers/log-helper'
import { OS } from '@/helpers/os'

/**
 * Check OS environment
 */
export default () =>
  new Promise(async (resolve, reject) => {
    LogHelper.info('Checking OS environment...')

    const info = OS.getInformation()

    if (info.type === 'windows') {
      LogHelper.error('Voice offline mode is not available on Windows')
      reject()
    } else if (info.type === 'unknown') {
      LogHelper.error(
        'This OS is unknown, please open an issue to let us know about it'
      )
      reject()
    } else {
      try {
        LogHelper.success(`You are running ${info.name}`)
        LogHelper.info('Checking tools...')

        await execa('tar', ['--version'])
        LogHelper.success('"tar" found')
        await execa('make', ['--version'])
        LogHelper.success('"make" found')

        if (info.type === 'macos') {
          await execa('brew', ['--version'])
          LogHelper.success('"brew" found')
          await execa('curl', ['--version'])
          LogHelper.success('"curl" found')
        } else if (info.type === 'linux') {
          await execa('apt-get', ['--version'])
          LogHelper.success('"apt-get" found')
          await execa('wget', ['--version'])
          LogHelper.success('"wget" found')
        }

        resolve()
      } catch (e) {
        if (e.cmd) {
          const cmd = e.cmd.substr(0, e.cmd.indexOf(' '))
          LogHelper.error(
            `The following command has failed: "${e.cmd}". "${cmd}" is maybe missing. To continue this setup, please install the required tool. More details about the failure: ${e}`
          )
        } else {
          LogHelper.error(`Failed to prepare the environment: ${e}`)
        }

        reject(e)
      }
    }
  })

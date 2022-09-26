import { command } from 'execa'

import { LogHelper } from '@/helpers/log-helper'

/**
 * Update version number in files which need version number
 */
export default (version) =>
  new Promise(async (resolve, reject) => {
    LogHelper.info('Updating version...')

    const promises = []
    const files = ['package.json', 'package-lock.json']

    for (let i = 0; i < files.length; i += 1) {
      promises.push(
        command(`json -I -f ${files[i]} -e 'this.version="${version}"'`, {
          shell: true
        })
      )
    }

    try {
      await Promise.all(promises)

      LogHelper.success(`Version updated to ${version}`)
      resolve()
    } catch (e) {
      LogHelper.error(`Error while updating version: ${e.stderr}`)
      reject(e)
    }
  })

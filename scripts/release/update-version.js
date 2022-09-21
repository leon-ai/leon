import { command } from 'execa'

import { LOG } from '@/helpers/log'

/**
 * Update version number in files which need version number
 */
export default (version) =>
  new Promise(async (resolve, reject) => {
    LOG.info('Updating version...')

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

      LOG.success(`Version updated to ${version}`)
      resolve()
    } catch (e) {
      LOG.error(`Error while updating version: ${e.stderr}`)
      reject(e)
    }
  })

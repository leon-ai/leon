import { shell } from 'execa'

import log from '@/helpers/log'

/**
 * Update version number in files which need version number
 */
export default version => new Promise(async (resolve, reject) => {
  log.info('Updating version...')

  const promises = []
  const files = [
    'package.json',
    'package-lock.json'
  ]

  for (let i = 0; i < files.length; i += 1) {
    promises.push(shell(`json -I -f ${files[i]} -e 'this.version="${version}"'`))
  }

  try {
    await Promise.all(promises)

    log.success(`Version updated to ${version}`)
    resolve()
  } catch (e) {
    log.error(`Error while updating version: ${e.stderr}`)
    reject(e)
  }
})

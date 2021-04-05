import fs from 'fs'
import { join } from 'path'

import log from '@/helpers/log'

/**
 * This script delete test DB files if they exist
 */
export default () => new Promise(async (resolve, reject) => {
  log.info('Cleaning test DB files...')

  const packagesFolder = join(__dirname, '../packages')
  const packages = fs.readdirSync(packagesFolder)
    .filter((entity) => fs.statSync(join(packagesFolder, entity)).isDirectory())

  for (let i = 0; i < packages.length; i += 1) {
    try {
      const dbFolder = join(packagesFolder, packages[i], 'data/db')
      const dbTestFiles = fs.readdirSync(dbFolder).filter((entity) => entity.indexOf('.spec.json') !== -1)

      if (dbTestFiles.length > 0) {
        log.info(`Deleting ${dbTestFiles[0]}...`)
        fs.unlinkSync(join(dbFolder, dbTestFiles[0]))
        log.success(`${dbTestFiles[0]} deleted`)
      }
    } catch (e) {
      log.error(`Failed to clean: ${packages[i]} test DB file`)
      reject(e)
    }
  }

  log.success('Cleaning done')
  resolve()
})

import fs from 'node:fs'
import path from 'node:path'

import { LogHelper } from '@/helpers/log-helper'

/**
 * Set up Leon's core configuration
 */
export default () =>
  new Promise(async (resolve) => {
    LogHelper.info('Configuring core...')

    const dir = 'core/config'
    const list = async (dir) => {
      const entities = await fs.promises.readdir(dir)

      // Browse core config entities
      for (let i = 0; i < entities.length; i += 1) {
        const file = `${entities[i].replace('.sample.json', '.json')}`
        // Recursive if the entity is a directory
        const way = path.join(dir, entities[i])
        if ((await fs.promises.stat(way)).isDirectory()) {
          await list(way)
        } else if (
          entities[i].indexOf('.sample.json') !== -1 &&
          !fs.existsSync(`${dir}/${file}`)
        ) {
          // Clone config from sample in case there is no existing config file
          fs.createReadStream(`${dir}/${entities[i]}`).pipe(
            fs.createWriteStream(`${dir}/${file}`)
          )

          LogHelper.success(`${file} file created`)
        } else if (
          entities[i].indexOf('.sample.json') !== -1 &&
          fs.existsSync(`${dir}/${file}`)
        ) {
          LogHelper.success(`${file} already exists`)
        }
      }
    }

    await list(dir)
    resolve()
  })

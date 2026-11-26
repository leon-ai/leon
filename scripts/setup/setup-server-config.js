import fs from 'node:fs'
import path from 'node:path'

import { createSetupStatus } from './setup-status'

/**
 * Prepare the server's default configuration from the checked-in samples.
 */
export default () =>
  new Promise(async (resolve) => {
    const status = createSetupStatus('Preparing server configuration...').start()
    let hasUpdatedServerConfig = false

    const dir = 'core/config'
    const list = async (dir) => {
      const entities = await fs.promises.readdir(dir)

      // Copy missing defaults throughout the server configuration directory.
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
          hasUpdatedServerConfig = true
        }
      }
    }

    await list(dir)
    status.succeed(
      hasUpdatedServerConfig ? 'Server configuration: updated' : 'Server configuration: ready'
    )
    resolve()
  })

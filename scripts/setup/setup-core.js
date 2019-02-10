import fs from 'fs'
import path from 'path'

import log from '@/helpers/log'

/**
 * Setup Leon's core configuration
 */
export default () => new Promise((resolve) => {
  log.info('Configuring core...')

  const dir = 'server/src/config'
  const list = (dir) => {
    const entities = fs.readdirSync(dir)

    // Browse core config entities
    for (let i = 0; i < entities.length; i += 1) {
      const file = `${entities[i].replace('.sample.json', '.json')}`
      // Recursive if the entity is a directory
      const way = path.join(dir, entities[i])
      if (fs.statSync(way).isDirectory()) {
        list(way)
      } else if (entities[i].indexOf('.sample.json') !== -1 &&
        !fs.existsSync(`${dir}/${file}`)) { // Clone config from sample in case there is no existing config file
        fs.createReadStream(`${dir}/${entities[i]}`)
          .pipe(fs.createWriteStream(`${dir}/${file}`))

        log.success(`${file} file created`)
      } else if (entities[i].indexOf('.sample.json') !== -1 &&
        fs.existsSync(`${dir}/${file}`)) {
        log.success(`${file} already exists`)
      }
    }
  }

  list(dir)
  resolve()
})

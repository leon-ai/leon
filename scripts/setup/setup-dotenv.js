import { prompt } from 'inquirer'
import fs from 'fs'

import log from '@/helpers/log'

/**
 * Duplicate the .env.sample to .env file
 */
export default () => new Promise(async (resolve) => {
  log.info('.env file creation...')

  const createDotenv = () => {
    fs.createReadStream('.env.sample')
      .pipe(fs.createWriteStream('.env'))

    log.success('.env file created')
  }

  if (!fs.existsSync('.env')) {
    createDotenv()

    resolve()
  } else if (process.env.IS_DOCKER === 'true') {
    resolve()
  } else {
    const answer = await prompt({
      type: 'confirm',
      name: 'dotenv.overwrite',
      message: '.env file already exists, overwrite:',
      default: false
    })

    if (answer.dotenv.overwrite === true) {
      createDotenv()
    }

    resolve()
  }
})

import fs from 'fs'
import browserify from 'browserify'
import envify from 'envify/custom'
import dotenv from 'dotenv'

import log from '@/helpers/log'

/**
 * Build web app
 */
export default () => new Promise((resolve) => {
  // read .env file from leon root directory
  dotenv.config()
  browserify('app/js/main.es6.js')
    .transform('babelify')
    .transform(envify(process.env))
    .bundle()
    .on('error', err => log.error(`[${err.name}] ${err.message}`))
    .pipe(fs.createWriteStream('app/js/main.js'))

  log.success('Web app built')
  resolve()
})

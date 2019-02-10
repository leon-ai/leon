import fs from 'fs'
import browserify from 'browserify'

import log from '@/helpers/log'

/**
 * Build web app
 */
export default () => new Promise((resolve) => {
  browserify('app/js/main.es6.js')
    .transform('babelify')
    .bundle()
    .on('error', err => log.error(`[${err.name}] ${err.message}`))
    .pipe(fs.createWriteStream('app/js/main.js'))

  log.success('Web app built')
  resolve()
})

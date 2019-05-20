import browserSync from 'browser-sync'
import devip from 'dev-ip'

import buildApp from './build-app'

/**
 * Serve webapp
 */
export default () => new Promise((resolve) => {
  const bs = browserSync.create()

  const globs = [
    'app/js/**/*.es6.js',
    'app/css/**/*.css',
    'app/*.html'
  ]

  for (let i = 0; i < globs.length; i += 1) {
    if (globs[i].indexOf('.es6.js') !== -1) {
      bs.watch(globs[i], async (e) => {
        if (e === 'change') {
          await buildApp()

          bs.reload(globs[i])
        }
      })
    } else {
      bs.watch(globs[i])
        .on('change', bs.reload)
    }
  }

  bs.init({
    host: devip(),
    port: 4242,
    open: true,
    server: {
      baseDir: 'app/',
      index: 'index.html'
    }
  })

  resolve()
})

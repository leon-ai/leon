import { command } from 'execa'

import { log } from '@/helpers/log'

/**
 * Build web app
 */
export default () =>
  new Promise(async (resolve) => {
    await command('vite --config app/vite.config.js build', {
      shell: true,
      stdout: 'inherit'
    })

    log.success('Web app built')
    resolve()
  })

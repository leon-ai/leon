import { command } from 'execa'

import { LogHelper } from '@/helpers/log-helper'

/**
 * Build web app
 */
export default () =>
  new Promise(async (resolve) => {
    await command('vite --config app/vite.config.js build', {
      shell: true,
      stdout: 'inherit'
    })

    LogHelper.success('Web app built')
    resolve()
  })

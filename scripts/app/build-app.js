import { execa } from 'execa'

import { LogHelper } from '@/helpers/log-helper'

/**
 * Build the selected client bundle for Leon's HTTP server.
 */
export default async function buildApp(options = {}) {
  const { quiet = false, configFile = 'apps/web-legacy/vite.config.js' } = options

  await execa('vite', ['build', '--config', configFile], {
    stdio: quiet ? 'ignore' : 'inherit'
  })

  if (!quiet) {
    LogHelper.success('Web app built')
  }
}

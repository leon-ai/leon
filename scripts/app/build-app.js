import { execa } from 'execa'

import { LogHelper } from '@/helpers/log-helper'

/**
 * Build web app
 */
export default async function buildApp(options = {}) {
  const { quiet = false } = options

  await execa('vite', ['build', '--config', 'app/vite.config.js'], {
    stdio: quiet ? 'ignore' : 'inherit'
  })

  if (!quiet) {
    LogHelper.success('Web app built')
  }
}

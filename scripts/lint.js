import execa from 'execa'

import { LogHelper } from '@/helpers/log-helper'
import { LoaderHelper } from '@/helpers/loader-helper'

import buildAurora from './build-aurora.js'

const globs = [
  'app/src/js/*.{ts,js}',
  'aurora/src/**/*.{ts,tsx,js,jsx}',
  'web-app/src/**/*.{ts,tsx}',
  'web-app/vite.config.ts',
  // TODO: deal with it once handling new hotword
  // '"hotword/index.{ts,js}"',
  'skills/**/*.{ts,js}',
  'scripts/**/*.{ts,js}',
  'server/src/**/*.{ts,js}',
  'test/**/*.{ts,js}',
  'tools/**/*.ts'
]

/**
 * This script ensures the correct coding syntax of the whole project
 */
;(async () => {
  LoaderHelper.start()
  LogHelper.info('Linting...')

  try {
    await buildAurora({ quiet: true })
    // Reuse unchanged files while still running both full TypeScript checks below.
    await execa('eslint', [...globs, '--fix', '--cache', '--cache-strategy', 'content', '--ignore-pattern', '.gitignore'], {
      stdio: 'inherit'
    })
    await execa('tsc', ['--noEmit', '-p', 'tsconfig.json'], {
      stdio: 'inherit'
    })
    await execa('tsc', ['--noEmit', '-p', 'web-app/tsconfig.json'], {
      stdio: 'inherit'
    })

    LogHelper.success('Looks great')
    LoaderHelper.stop()
  } catch (e) {
    LogHelper.error(`Does not look great: ${e.message}`)
    LoaderHelper.stop()
    process.exit(1)
  }
})()

import execa from 'execa'

import { LogHelper } from '@/helpers/log-helper'
import { LoaderHelper } from '@/helpers/loader-helper'

import buildAurora from './build-aurora.js'

const globs = [
  'app/src/js/*.{ts,js}',
  'aurora/src/**/*.{ts,tsx,js,jsx}',
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
    await execa('eslint', [...globs, '--fix', '--ignore-pattern', '.gitignore'], {
      stdio: 'inherit'
    })
    await execa('tsc', ['--noEmit', '-p', 'tsconfig.json'], {
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

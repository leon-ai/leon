import { execa } from 'execa'

import { LogHelper } from '@/helpers/log-helper'
import { LoaderHelper } from '@/helpers/loader-helper'

import buildAurora from './build-aurora.js'

// Keep full-repository results separate from staged-file and ad hoc ESLint runs.
const ESLINT_CACHE_PATH = 'node_modules/.cache/eslint/full'

const globs = [
  'apps/web-legacy/src/js/*.{ts,js}',
  'aurora/src/**/*.{ts,tsx,js,jsx}',
  'apps/web/src/**/*.{ts,tsx}',
  'apps/web/vite.config.ts',
  // TODO: deal with it once handling new hotword
  // '"hotword/index.{ts,js}"',
  'skills/**/*.{ts,js}',
  'scripts/**/*.{ts,js}',
  'bridges/runtime/**/*.ts',
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
    await execa('eslint', [
      ...globs,
      '--fix',
      '--cache',
      '--cache-strategy', 'content',
      '--cache-location', ESLINT_CACHE_PATH,
      '--ignore-pattern', '.gitignore'
    ], {
      stdio: 'inherit'
    })
    await execa('tsc', ['--noEmit', '-p', 'tsconfig.json'], {
      stdio: 'inherit'
    })
    await execa('tsc', ['--noEmit', '-p', 'apps/web/tsconfig.json'], {
      stdio: 'inherit'
    })
    await execa('tsc', ['--noEmit', '-p', 'test/web-app/tsconfig.json'], {
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

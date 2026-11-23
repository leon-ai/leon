import { execa } from 'execa'
import { parseArgs } from 'node:util'

import { LogHelper } from '@/helpers/log-helper'
import { LoaderHelper } from '@/helpers/loader-helper'

import buildAurora from './build-aurora.js'

// Keep full-repository results separate from staged-file and ad hoc ESLint runs.
const { values } = parseArgs({ options: { scope: { type: 'string', default: 'all' } } })
const SCOPES = ['all', 'core', 'desktop']
const DESKTOP_GLOBS = ['apps/desktop/**/*.{ts,tsx,mjs,js}']
const CORE_PROJECTS = ['tsconfig.json', 'apps/web/tsconfig.json', 'test/web-app/tsconfig.json', 'scripts/release/tsconfig.json']
const DESKTOP_PROJECTS = ['apps/desktop/tsconfig.json']
const ESLINT_CACHE_PATH = `node_modules/.cache/eslint/${values.scope}`

const globs = [
  '.pnpmfile.mjs',
  'apps/web-legacy/src/js/*.{ts,js}',
  'aurora/src/**/*.{ts,tsx,js,jsx}',
  'apps/web/src/**/*.{ts,tsx}',
  'apps/web/vite.config.ts',
  'apps/web/vite/**/*.ts',
  // TODO: deal with it once handling new hotword
  // '"hotword/index.{ts,js}"',
  'skills/**/*.{ts,js}',
  'scripts/**/*.{ts,js}',
  'bridges/runtime/**/*.{ts,js}',
  'server/src/**/*.{ts,js}',
  'test/**/*.{ts,tsx,js}',
  'tools/**/*.ts'
]

/**
 * This script ensures the correct coding syntax of the whole project
 */
;(async () => {
  LoaderHelper.start()
  LogHelper.info('Linting...')

  try {
    if (!SCOPES.includes(values.scope)) {
      throw new Error(`Unknown lint scope: ${values.scope}. Use ${SCOPES.join(', ')}.`)
    }
    const selectedGlobs = values.scope === 'desktop' ? DESKTOP_GLOBS
      : values.scope === 'core' ? globs : [...globs, ...DESKTOP_GLOBS]
    const projects = values.scope === 'desktop' ? DESKTOP_PROJECTS
      : values.scope === 'core' ? CORE_PROJECTS : [...CORE_PROJECTS, ...DESKTOP_PROJECTS]
    await buildAurora({ quiet: true })
    // Reuse unchanged files while still checking every TypeScript project below.
    await execa('eslint', [
      ...selectedGlobs,
      '--fix',
      '--cache',
      '--cache-strategy', 'content',
      '--cache-location', ESLINT_CACHE_PATH,
      '--ignore-pattern', '.gitignore'
    ], {
      stdio: 'inherit'
    })
    for (const project of projects) {
      await execa('tsrs', ['--fast', '--noEmit', '-p', project], {
        stdio: 'inherit'
      })
    }

    LogHelper.success('Looks great')
    LoaderHelper.stop()
  } catch (e) {
    LogHelper.error(`Does not look great: ${e.message}`)
    LoaderHelper.stop()
    process.exit(1)
  }
})()

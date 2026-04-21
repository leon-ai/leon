import path from 'node:path'

import dotenv from 'dotenv'
import { defineConfig } from 'vitest/config'

import { PROFILE_DOT_ENV_PATH } from './server/src/leon-roots'

const ROOT_DIR = path.resolve()

dotenv.config({ path: PROFILE_DOT_ENV_PATH })

export default defineConfig({
  resolve: {
    alias: {
      '@@': ROOT_DIR,
      '@': path.join(ROOT_DIR, 'server', 'src'),
      '@bridge': path.join(ROOT_DIR, 'bridges', 'nodejs', 'src'),
      '@sdk': path.join(ROOT_DIR, 'bridges', 'nodejs', 'src', 'sdk')
    }
  },
  test: {
    environment: 'node',
    fileParallelism: false,
    disableConsoleIntercept: true,
    restoreMocks: true,
    clearMocks: true,
    unstubEnvs: true,
    testTimeout: 120_000
  }
})

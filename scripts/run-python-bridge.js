import { spawn } from 'node:child_process'

import {
  PYTHON_BRIDGE_ENTRY_PATH,
  PYTHON_BRIDGE_RUNTIME_BIN_PATH
} from '@/constants'
import { LogHelper } from '@/helpers/log-helper'

/**
 * Run the Python bridge directly from source with Leon's managed Python
 * runtime. This keeps local development aligned with the runtime used by Leon.
 */
;(async () => {
  const args = process.argv.slice(2)
  const child = spawn(
    PYTHON_BRIDGE_RUNTIME_BIN_PATH,
    [PYTHON_BRIDGE_ENTRY_PATH, ...args],
    {
      stdio: 'inherit',
      windowsHide: true
    }
  )

  child.on('exit', (code) => {
    process.exit(code ?? 0)
  })

  child.on('error', (error) => {
    LogHelper.error(`Failed to start the Python bridge: ${error}`)
    process.exit(1)
  })
})()

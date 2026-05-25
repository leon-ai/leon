import { spawn } from 'node:child_process'

import { PNPM_RUNTIME_BIN_PATH } from '@/constants'
import { RuntimeHelper } from '@/helpers/runtime-helper'

import { setupConsola } from './setup-ui'

const POST_SETUP_ACTIONS = [
  {
    label: 'Start me now',
    value: 'start-me-now'
  },
  {
    label: 'Finish',
    value: 'finish'
  }
]

async function runLeonStartCommand() {
  const startCommand = process.platform === 'win32'
    ? {
        command: 'cmd.exe',
        args: ['/c', PNPM_RUNTIME_BIN_PATH, 'start']
      }
    : {
        command: PNPM_RUNTIME_BIN_PATH,
        args: ['start']
      }

  await new Promise((resolve, reject) => {
    const child = spawn(startCommand.command, startCommand.args, {
      cwd: process.cwd(),
      env: {
        ...RuntimeHelper.getManagedNodeEnvironment(process.env),
        LEON_OPEN_BROWSER: 'true'
      },
      stdio: 'inherit',
      windowsHide: true
    })

    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal)
        return
      }

      if ((code ?? 0) !== 0) {
        reject(new Error(`Leon exited with code ${code ?? 0}`))
        return
      }

      resolve(undefined)
    })
  })
}

export default async function postSetup() {
  if (
    process.env['IS_DOCKER'] === 'true' ||
    !process.stdin.isTTY ||
    !process.stdout.isTTY
  ) {
    return
  }

  const nextAction = await setupConsola.prompt('What do you want to do next?', {
    type: 'select',
    options: POST_SETUP_ACTIONS,
    initialValue: POST_SETUP_ACTIONS[1].value,
    cancel: 'default'
  })

  if (nextAction !== 'start-me-now') {
    return
  }

  await runLeonStartCommand()
}

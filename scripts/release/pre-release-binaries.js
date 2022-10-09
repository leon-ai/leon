import path from 'node:path'

import { prompt } from 'inquirer'
import { command } from 'execa'

import { PYTHON_BRIDGE_SRC_PATH, TCP_SERVER_SRC_PATH } from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import { LoaderHelper } from '@/helpers/loader-helper'

/**
 * Pre-release binaries via GitHub Actions
 * 1. Ask for confirmation whether the binary version has been bumped
 * 2. Trigger GitHub workflow to pre-release binaries
 */

const BUILD_TARGETS = new Map()
const WORKFLOWS_PATH = path.join('.github', 'workflows')

BUILD_TARGETS.set('python-bridge', {
  workflowFileName: 'build-python-bridge.yml',
  setupFilePath: path.join(PYTHON_BRIDGE_SRC_PATH, 'setup.py')
})
BUILD_TARGETS.set('tcp-server', {
  workflowFileName: 'build-tcp-server.yml',
  setupFilePath: path.join(TCP_SERVER_SRC_PATH, 'setup.py')
})
;(async () => {
  LoaderHelper.start()

  const { argv } = process
  const givenReleaseTarget = argv[2].toLowerCase()
  const { workflowFileName, setupFilePath } =
    BUILD_TARGETS.get(givenReleaseTarget)
  const workflowFilePath = path.join(WORKFLOWS_PATH, workflowFileName)

  LoaderHelper.stop()
  const answer = await prompt({
    type: 'confirm',
    name: 'binary.bumped',
    message: `Have you bumped the version number of the binary from the "${setupFilePath}" file?`,
    default: false
  })
  LoaderHelper.start()

  if (!answer.binary.bumped) {
    LogHelper.info(
      'Please bump the version number of the binary from the setup file before continuing'
    )
    process.exit(0)
  }

  try {
    LogHelper.info('Triggering the GitHub workflow...')

    await command(`gh workflow run ${workflowFilePath}`, {
      shell: true,
      stdout: 'inherit'
    })

    LogHelper.success(
      'GitHub workflow triggered. The pre-release is on its way!'
    )
    LogHelper.success(
      'Once the pre-release is done, go to the GitHub releases to double-check information and hit release'
    )
  } catch (e) {
    LogHelper.error(
      `An error occurred while triggering the GitHub workflow: ${e}`
    )
    process.exit(1)
  }
})()

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

BUILD_TARGETS.set('python-bridge', {
  workflowFileName: 'pre-release-python-bridge.yml',
  setupFilePath: path.join(PYTHON_BRIDGE_SRC_PATH, 'setup.py')
})
BUILD_TARGETS.set('tcp-server', {
  workflowFileName: 'pre-release-tcp-server.yml',
  setupFilePath: path.join(TCP_SERVER_SRC_PATH, 'setup.py')
})
;(async () => {
  LoaderHelper.start()

  const { argv } = process
  const givenReleaseTarget = argv[2].toLowerCase()
  const givenBranch = argv[3]?.toLowerCase()
  const { workflowFileName, setupFilePath } =
    BUILD_TARGETS.get(givenReleaseTarget)

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

    const runWorkflowCommand = !givenBranch
      ? `gh workflow run ${workflowFileName}`
      : `gh workflow run ${workflowFileName} --ref ${givenBranch}`

    await command(runWorkflowCommand, {
      shell: true,
      stdout: 'inherit'
    })

    LogHelper.success(
      'GitHub workflow triggered. The pre-release is on its way!'
    )
    LogHelper.success(
      'Once the pre-release is done, go to the GitHub releases to double-check information and hit release'
    )

    process.exit(0)
  } catch (e) {
    LogHelper.error(
      `An error occurred while triggering the GitHub workflow: ${e}`
    )
    process.exit(1)
  }
})()

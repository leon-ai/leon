import fs from 'node:fs'
import path from 'node:path'

import { command } from 'execa'

import { LogHelper } from '@/helpers/log-helper'
import { LoaderHelper } from '@/helpers/loader-helper'

/**
 * Set up development environment according to the given setup target
 * 1. Verify Python environment
 * 2. Verify if the targeted development environment is up-to-date
 * 3. If up-to-date, exit
 * 4. If not up-to-date, delete the outdated development environment and install the new one
 * 5. Install spaCy models if the targeted development environment is the TCP server
 */

const SETUP_TARGETS = new Map()
// Find new spaCy models:  https://github.com/explosion/spacy-models/releases
const SPACY_MODELS = ['en_core_web_trf-3.4.0', 'fr_core_news_md-3.4.0']
const PYTHON_BRIDGE_SRC_PATH = 'bridges/python/src'
const TCP_SERVER_SRC_PATH = 'tcp_server/src'

SETUP_TARGETS.set('python-bridge', {
  name: 'Python bridge',
  pipfilePath: path.join(PYTHON_BRIDGE_SRC_PATH, 'Pipfile'),
  dotVenvPath: path.join(PYTHON_BRIDGE_SRC_PATH, '.venv'),
  dotProjectPath: path.join(PYTHON_BRIDGE_SRC_PATH, '.venv', '.project')
})
SETUP_TARGETS.set('tcp-server', {
  name: 'TCP server',
  pipfilePath: path.join(TCP_SERVER_SRC_PATH, 'Pipfile'),
  dotVenvPath: path.join(TCP_SERVER_SRC_PATH, '.venv'),
  dotProjectPath: path.join(TCP_SERVER_SRC_PATH, '.venv', '.project')
})
;(async () => {
  LoaderHelper.start()

  const { argv } = process
  const givenSetupTarget = argv[2].toLowerCase()

  if (!SETUP_TARGETS.has(givenSetupTarget)) {
    LogHelper.error(
      `Invalid setup target: ${givenSetupTarget}. Valid targets are: ${Array.from(
        SETUP_TARGETS.keys()
      ).join(', ')}`
    )
    process.exit(1)
  }

  const {
    name: setupTarget,
    pipfilePath,
    dotVenvPath,
    dotProjectPath
  } = SETUP_TARGETS.get(givenSetupTarget)

  LogHelper.info('Checking Python environment...')

  /**
   * Verify Python environment
   */

  // Check if the Pipfile exists
  if (fs.existsSync(pipfilePath)) {
    LogHelper.success(`${pipfilePath} found`)

    try {
      // Check if Pipenv is installed
      const pipenvVersionChild = await command('pipenv --version', {
        shell: true
      })
      let pipenvVersion = String(pipenvVersionChild.stdout)

      if (pipenvVersion.includes('version')) {
        pipenvVersion = pipenvVersion.split('version')[1].trim()
        pipenvVersion = `${pipenvVersion} version`
      }

      LogHelper.success(`Pipenv ${pipenvVersion} found`)
    } catch (e) {
      LogHelper.error(
        `${e}\nPlease install Pipenv: "pip install pipenv" or read the documentation https://docs.pipenv.org`
      )
      process.exit(1)
    }
  }

  /**
   * Install Python packages
   */

  LogHelper.info(`Setting up ${setupTarget} development environment...`)

  const pipfileMtime = fs.statSync(pipfilePath).mtime
  const hasDotVenv = fs.existsSync(dotVenvPath)
  const installPythonPackages = async () => {
    LogHelper.info(`Installing Python packages from ${pipfilePath}.lock...`)

    // Delete .venv directory to reset the development environment
    if (hasDotVenv) {
      LogHelper.info(`Deleting ${dotVenvPath}...`)
      fs.rmSync(dotVenvPath, { recursive: true, force: true })
      LogHelper.success(`${dotVenvPath} deleted`)
    }

    try {
      await command(`pipenv install --site-packages`, {
        shell: true,
        stdio: 'inherit'
      })

      LogHelper.success('Python packages installed')
    } catch (e) {
      LogHelper.error(`Failed to install Python packages: ${e}`)
      process.exit(1)
    }

    try {
      if (givenSetupTarget === 'tcp-server') {
        LogHelper.info('Installing spaCy models...')

        // Install models one by one to avoid network throttling
        for (const model of SPACY_MODELS) {
          await command(`pipenv run spacy download ${model} --direct`, {
            shell: true,
            stdio: 'inherit'
          })
        }

        LogHelper.success('spaCy models installed')
      }
    } catch (e) {
      LogHelper.error(`Failed to install spaCy models: ${e}`)
      process.exit(1)
    }
  }

  /**
   * Verify if a fresh development environment installation is necessary
   */

  try {
    // Required environment variables to set up
    process.env.PIPENV_PIPFILE = pipfilePath
    process.env.PIPENV_VENV_IN_PROJECT = true

    if (givenSetupTarget === 'python-bridge') {
      // As per: https://github.com/marcelotduarte/cx_Freeze/issues/1548
      process.env.PIP_NO_BINARY = 'cx_Freeze'
    }

    if (!hasDotVenv) {
      await installPythonPackages()
    } else if (givenSetupTarget === 'tcp-server') {
      /**
       * When TCP server setup target, verify whether all spaCy models are installed
       */
      let hasAllSpacyModelsInstalled = false

      if (givenSetupTarget === 'tcp-server') {
        LogHelper.info('Checking whether all spaCy models are installed...')

        const toGraphModelName = (model) => {
          const [name, version] = model.split('-')

          return `${name.replaceAll('_', '-')}==${version}`
        }
        let { stdout: graph } = await command('pipenv graph', { shell: true })
        graph = graph.split('\n')

        const models = new Map()
        SPACY_MODELS.forEach((model) =>
          models.set(toGraphModelName(model), { isInstalled: false })
        )

        SPACY_MODELS.forEach((model) => {
          /**
           * From the deps graph, models appear like this: fr-core-news-md==3.4.0
           * So we need to comply to this format on the fly
           */

          model = toGraphModelName(model)

          if (graph.includes(model)) {
            models.set(model, { isInstalled: true })
          }
        })

        for (const { isInstalled } of models.values()) {
          if (!isInstalled) {
            break
          }

          hasAllSpacyModelsInstalled = true
        }

        if (!hasAllSpacyModelsInstalled) {
          LogHelper.info('Not all spaCy models are installed')
          await installPythonPackages()
        } else {
          LogHelper.success('All spaCy models are already installed')
        }
      }
    }

    if (fs.existsSync(dotProjectPath)) {
      const dotProjectMtime = fs.statSync(dotProjectPath).mtime

      // Check if Python deps tree has been modified since the initial setup
      if (pipfileMtime > dotProjectMtime) {
        await installPythonPackages()
      } else {
        LogHelper.success('Python packages are up-to-date')
      }
    } else {
      await installPythonPackages()
    }

    LogHelper.success(`${setupTarget} development environment ready`)
  } catch (e) {
    LogHelper.error(
      `Failed to set up the ${setupTarget} development environment: ${e}`
    )
  } finally {
    LoaderHelper.stop()
  }
})()

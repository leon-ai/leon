import fs from 'node:fs'
import path from 'node:path'

import { command } from 'execa'

import {
  EN_SPACY_MODEL_NAME,
  EN_SPACY_MODEL_VERSION,
  FR_SPACY_MODEL_NAME,
  FR_SPACY_MODEL_VERSION,
  PYTHON_BRIDGE_SRC_PATH,
  TCP_SERVER_SRC_PATH
} from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import { LoaderHelper } from '@/helpers/loader-helper'
import { CPUArchitectures, OSHelper, OSTypes } from '@/helpers/os-helper'

/**
 * Set up development environment according to the given setup target
 * 1. Verify Python environment
 * 2. Verify if the targeted development environment is up-to-date
 * 3. If up-to-date, exit
 * 4. If not up-to-date, delete the outdated development environment and install the new one
 * 5. Install spaCy models if the targeted development environment is the TCP server
 */

// Define mirror to download models installation file
function getModelInstallationFileUrl(model, mirror = undefined) {
  const { name, version } = SPACY_MODELS.get(model)
  const suffix = 'py3-none-any.whl'
  let urlPrefix = 'https://github.com/explosion/spacy-models/releases/download'

  if (mirror === 'cn') {
    LogHelper.info(
      'Using Chinese mirror to download model installation file...'
    )
    urlPrefix =
      'https://download.fastgit.org/explosion/spacy-models/releases/download'
  }

  return `${urlPrefix}/${name}-${version}/${name}-${version}-${suffix}`
}

const SETUP_TARGETS = new Map()
const SPACY_MODELS = new Map()

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

SPACY_MODELS.set('en', {
  name: EN_SPACY_MODEL_NAME,
  version: EN_SPACY_MODEL_VERSION
})
SPACY_MODELS.set('fr', {
  name: FR_SPACY_MODEL_NAME,
  version: FR_SPACY_MODEL_VERSION
})
;(async () => {
  LoaderHelper.start()

  const { argv } = process
  const givenSetupTarget = argv[2].toLowerCase()
  // cn
  const givenMirror = argv[3]?.toLowerCase()

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
  const { type: osType, cpuArchitecture } = OSHelper.getInformation()
  const installPythonPackages = async () => {
    LogHelper.info(`Installing Python packages from ${pipfilePath}.lock...`)

    // Delete .venv directory to reset the development environment
    if (hasDotVenv) {
      LogHelper.info(`Deleting ${dotVenvPath}...`)
      fs.rmSync(dotVenvPath, { recursive: true, force: true })
      LogHelper.success(`${dotVenvPath} deleted`)
    }

    try {
      await command(`pipenv install --verbose --site-packages`, {
        shell: true,
        stdio: 'inherit'
      })

      if (
        osType === OSTypes.MacOS &&
        cpuArchitecture === CPUArchitectures.ARM64
      ) {
        LogHelper.info('macOS ARM64 detected')

        LogHelper.info(
          'Forcing setuptools and wheel Python packages to be installed as latest version...'
        )
        await command(`pipenv run pip install --upgrade setuptools wheel`, {
          shell: true,
          stdio: 'inherit'
        })
        LogHelper.success(
          'setuptools and wheel Python packages installed as latest version'
        )

        LogHelper.info(
          'Installing Rust installer as it is needed for the "tokenizers" package for macOS ARM64 architecture...'
        )
        await command(`curl https://sh.rustup.rs -sSf | sh -s -- -y`, {
          shell: true,
          stdio: 'inherit'
        })
        LogHelper.success('Rust installer installed')

        LogHelper.info('Reloading configuration from "$HOME/.cargo/env"...')
        await command(`source "$HOME/.cargo/env"`, {
          shell: true,
          stdio: 'inherit'
        })
        LogHelper.success('Configuration reloaded')

        LogHelper.info('Checking Rust compiler version...')
        await command(`rustc --version`, {
          shell: true,
          stdio: 'inherit'
        })
        LogHelper.success('Rust compiler OK')
      }

      LogHelper.success('Python packages installed')
    } catch (e) {
      LogHelper.error(`Failed to install Python packages: ${e}`)

      if (osType === OSTypes.Windows) {
        LogHelper.error(
          'Please check the error above. It might be related to Microsoft C++ Build Tools. If it is, you can check here: "https://stackoverflow.com/a/64262038/1768162" then restart your machine and retry'
        )
        LogHelper.error(
          'If it is related to some hash mismatch, you can try by installing Pipenv 2022.7.24: pip install pipenv==2022.7.24'
        )
      }

      process.exit(1)
    }
  }

  /**
   * Verify if a fresh development environment installation is necessary
   */

  // Required environment variables to set up
  process.env.PIPENV_PIPFILE = pipfilePath
  process.env.PIPENV_VENV_IN_PROJECT = true

  if (givenSetupTarget === 'python-bridge') {
    // As per: https://github.com/marcelotduarte/cx_Freeze/issues/1548
    process.env.PIP_NO_BINARY = 'cx_Freeze'
  }

  try {
    if (!hasDotVenv) {
      await installPythonPackages()
    } else {
      if (fs.existsSync(dotProjectPath)) {
        const dotProjectMtime = fs.statSync(dotProjectPath).mtime

        // Check if Python deps tree has been modified since the initial setup
        if (pipfileMtime > dotProjectMtime) {
          LogHelper.info('The development environment is not up-to-date')
          await installPythonPackages()
        } else {
          LogHelper.success('Python packages are up-to-date')
        }
      } else {
        await installPythonPackages()
      }
    }
  } catch (e) {
    LogHelper.error(
      `Failed to set up the ${setupTarget} development environment: ${e}`
    )
  } finally {
    LoaderHelper.stop()
  }

  if (givenSetupTarget === 'tcp-server') {
    const installSpacyModels = async () => {
      try {
        LogHelper.info('Installing spaCy models...')

        // Install models one by one to avoid network throttling
        for (const modelLanguage of SPACY_MODELS.keys()) {
          const modelInstallationFileUrl = getModelInstallationFileUrl(
            modelLanguage,
            givenMirror
          )

          await command(`pipenv run pip install ${modelInstallationFileUrl}`, {
            shell: true,
            stdio: 'inherit'
          })
        }

        LogHelper.success('spaCy models installed')
      } catch (e) {
        LogHelper.error(`Failed to install spaCy models: ${e}`)
        process.exit(1)
      }
    }

    LogHelper.info('Checking whether all spaCy models are installed...')

    try {
      for (const { name: modelName } of SPACY_MODELS.values()) {
        const { stderr } = await command(
          `pipenv run python -c "import ${modelName}"`,
          { shell: true }
        )

        // Check stderr output for Windows as no exception is thrown
        if (osType === OSTypes.Windows) {
          if (String(stderr).length > 0) {
            await installSpacyModels()
            break
          }
        }
      }

      LogHelper.success('All spaCy models are already installed')
    } catch (e) {
      LogHelper.info('Not all spaCy models are installed')
      await installSpacyModels()
    }
  }

  LogHelper.success(`${setupTarget} development environment ready`)
})()

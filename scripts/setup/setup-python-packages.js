import { command } from 'execa'
import fs from 'fs'
import path from 'path'

import log from '@/helpers/log'

/**
 * Download and setup Leon's Python packages dependencies
 */
export default () => new Promise(async (resolve, reject) => {
  log.info('Checking Python env...')

  // Check if the Pipfile exists
  if (fs.existsSync('bridges/python/Pipfile')) {
    log.success('bridges/python/Pipfile found')

    try {
      // Check if Pipenv is installed
      const pipenvVersionChild = await command('pipenv --version', { shell: true })
      let pipenvVersion = pipenvVersionChild.stdout

      if (pipenvVersion.indexOf('version') !== -1) {
        pipenvVersion = pipenvVersion.substr(pipenvVersion.indexOf('version') + 'version '.length)
        pipenvVersion = `${pipenvVersion} version`
      }

      log.success(`Pipenv ${pipenvVersion} found`)
    } catch (e) {
      log.error(`${e}\nPlease install Pipenv: "pip install pipenv" or read the documentation https://docs.pipenv.org`)
      reject(e)
    }

    try {
      const dotVenvPath = path.join(process.cwd(), 'bridges/python/.venv')
      const pipfileLockPath = path.join(process.cwd(), 'bridges/python/Pipfile.lock')
      const pipfileLockMtime = fs.statSync(pipfileLockPath).mtime
      const isDotVenvExist = fs.existsSync(dotVenvPath)
      const installPythonPackages = async () => {
        // Installing Python packages
        log.info('Installing Python packages from bridges/python/Pipfile...')

        await command('pipenv install', { shell: true })
        log.success('Python packages installed')

        log.info('Installing spaCy models...')
        // Find new spaCy models:  https://github.com/explosion/spacy-models/releases
        await Promise.all([
          command('pipenv run spacy download en_core_web_trf-3.3.0 --direct', { shell: true }),
          command('pipenv run spacy download fr_core_news_md-3.3.0 --direct', { shell: true })
        ])

        log.success('spaCy models installed')
      }

      if (!isDotVenvExist) {
        await installPythonPackages()
      } else {
        const dotProjectPath = path.join(process.cwd(), 'bridges/python/.venv/.project')
        const dotProjectMtime = fs.statSync(dotProjectPath).mtime

        // Check if Python deps tree has been modified since the initial setup
        if (pipfileLockMtime > dotProjectMtime) {
          await installPythonPackages()
        } else {
          log.success('Python packages are up-to-date')
        }
      }

      resolve()
    } catch (e) {
      log.error(`Failed to install the Python packages: ${e}`)
      reject(e)
    }
  } else {
    log.error('bridges/python/Pipfile does not exist. Try to pull the project (git pull)')
    reject()
  }
})

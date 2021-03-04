import { command } from 'execa'
import fs from 'fs'

import log from '@/helpers/log'

/**
 * Download and setup Leon's packages Python dependencies
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
        pipenvVersion = pipenvVersion.substr(0, pipenvVersion.length - 1)
        pipenvVersion = `${pipenvVersion} version`
      }

      log.success(`Pipenv ${pipenvVersion} found`)
    } catch (e) {
      log.error(`${e}\nPlease install Pipenv: "pip install pipenv" or read the documentation https://docs.pipenv.org`)
      reject(e)
    }

    try {
      // Installing Python packages
      log.info('Installing Python packages from bridges/python/Pipfile.lock...')

      await command('pipenv --three', { shell: true })
      await command('pipenv install --skip-lock', { shell: true })
      log.success('Python packages installed')
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

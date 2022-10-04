import fs from 'node:fs'
import path from 'node:path'

import { command } from 'execa'

import { LogHelper } from '@/helpers/log-helper'

/**
 * Download and setup Leon's Python packages dependencies
 */
export default () =>
  new Promise(async (resolve, reject) => {
    LogHelper.info('Checking Python env...')

    // Check if the Pipfile exists
    if (fs.existsSync('bridges/python/src/Pipfile')) {
      LogHelper.success('bridges/python/src/Pipfile found')

      try {
        // Check if Pipenv is installed
        const pipenvVersionChild = await command('pipenv --version', {
          shell: true
        })
        let pipenvVersion = pipenvVersionChild.stdout

        if (pipenvVersion.indexOf('version') !== -1) {
          pipenvVersion = pipenvVersion.substr(
            pipenvVersion.indexOf('version') + 'version '.length
          )
          pipenvVersion = `${pipenvVersion} version`
        }

        LogHelper.success(`Pipenv ${pipenvVersion} found`)
      } catch (e) {
        LogHelper.error(
          `${e}\nPlease install Pipenv: "pip install pipenv" or read the documentation https://docs.pipenv.org`
        )
        reject(e)
      }

      try {
        const dotVenvPath = path.join(process.cwd(), 'bridges/python/src/.venv')
        const pipfilePath = path.join(
          process.cwd(),
          'bridges/python/src/Pipfile'
        )
        const pipfileMtime = fs.statSync(pipfilePath).mtime
        const isDotVenvExist = fs.existsSync(dotVenvPath)
        const installPythonPackages = async () => {
          if (isDotVenvExist) {
            LogHelper.info(`Deleting ${dotVenvPath}...`)
            fs.rmSync(dotVenvPath, { recursive: true, force: true })
            LogHelper.success(`${dotVenvPath} deleted`)
          }

          // Installing Python packages
          LogHelper.info(
            'Installing Python packages from bridges/python/src/Pipfile...'
          )

          await command('pipenv install --site-packages --dev', { shell: true })
          LogHelper.success('Python packages installed')

          LogHelper.info('Installing spaCy models...')
          // Find new spaCy models:  https://github.com/explosion/spacy-models/releases
          await Promise.all([
            command(
              'pipenv run spacy download en_core_web_trf-3.4.0 --direct',
              { shell: true }
            ),
            command(
              'pipenv run spacy download fr_core_news_md-3.4.0 --direct',
              { shell: true }
            )
          ])

          LogHelper.success('spaCy models installed')
        }

        if (!isDotVenvExist) {
          await installPythonPackages()
        } else {
          const dotProjectPath = path.join(
            process.cwd(),
            'bridges/python/src/.venv/.project'
          )
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
        }

        resolve()
      } catch (e) {
        LogHelper.error(`Failed to install the Python packages: ${e}`)
        reject(e)
      }
    } else {
      LogHelper.error(
        'bridges/python/src/Pipfile does not exist. Try to pull the project (git pull)'
      )
      reject()
    }
  })

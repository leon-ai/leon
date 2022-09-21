import { command } from 'execa'
import fs from 'fs'
import path from 'path'

import { LOG } from '@/helpers/log'

/**
 * Download and setup Leon's Python packages dependencies
 */
export default () =>
  new Promise(async (resolve, reject) => {
    LOG.info('Checking Python env...')

    // Check if the Pipfile exists
    if (fs.existsSync('bridges/python/Pipfile')) {
      LOG.success('bridges/python/Pipfile found')

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

        LOG.success(`Pipenv ${pipenvVersion} found`)
      } catch (e) {
        LOG.error(
          `${e}\nPlease install Pipenv: "pip install pipenv" or read the documentation https://docs.pipenv.org`
        )
        reject(e)
      }

      try {
        const dotVenvPath = path.join(process.cwd(), 'bridges/python/.venv')
        const pipfilePath = path.join(process.cwd(), 'bridges/python/Pipfile')
        const pipfileMtime = fs.statSync(pipfilePath).mtime
        const isDotVenvExist = fs.existsSync(dotVenvPath)
        const installPythonPackages = async () => {
          if (isDotVenvExist) {
            LOG.info(`Deleting ${dotVenvPath}...`)
            fs.rmSync(dotVenvPath, { recursive: true, force: true })
            LOG.success(`${dotVenvPath} deleted`)
          }

          // Installing Python packages
          LOG.info('Installing Python packages from bridges/python/Pipfile...')

          await command('pipenv install --site-packages', { shell: true })
          LOG.success('Python packages installed')

          LOG.info('Installing spaCy models...')
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

          LOG.success('spaCy models installed')
        }

        if (!isDotVenvExist) {
          await installPythonPackages()
        } else {
          const dotProjectPath = path.join(
            process.cwd(),
            'bridges/python/.venv/.project'
          )
          if (fs.existsSync(dotProjectPath)) {
            const dotProjectMtime = fs.statSync(dotProjectPath).mtime

            // Check if Python deps tree has been modified since the initial setup
            if (pipfileMtime > dotProjectMtime) {
              await installPythonPackages()
            } else {
              LOG.success('Python packages are up-to-date')
            }
          } else {
            await installPythonPackages()
          }
        }

        resolve()
      } catch (e) {
        LOG.error(`Failed to install the Python packages: ${e}`)
        reject(e)
      }
    } else {
      LOG.error(
        'bridges/python/Pipfile does not exist. Try to pull the project (git pull)'
      )
      reject()
    }
  })

import fs from 'node:fs'

import { command } from 'execa'

import { LogHelper } from '@/helpers/log-helper'

/**
 * Update version number in files which need version number
 */
export default (version) =>
  new Promise(async (resolve, reject) => {
    const changelog = 'CHANGELOG.md'
    const tmpChangelog = 'TMP-CHANGELOG.md'

    LogHelper.info(`Generating ${changelog}...`)

    try {
      await command(
        `git-changelog --changelogrc .changelogrc --template scripts/assets/CHANGELOG-TEMPLATE.md --file scripts/tmp/${tmpChangelog} --version_name ${version}`,
        { shell: true }
      )
    } catch (e) {
      LogHelper.error(`Error during git-changelog: ${e}`)
      reject(e)
    }

    try {
      LogHelper.info('Getting remote origin URL...')
      LogHelper.info('Getting previous tag...')

      const sh = await command(
        'git config --get remote.origin.url && git tag | tail -n1',
        { shell: true }
      )

      const repoUrl = sh.stdout.substr(0, sh.stdout.lastIndexOf('.git'))
      const previousTag = sh.stdout.substr(sh.stdout.indexOf('\n') + 1).trim()
      const changelogData = fs.readFileSync(changelog, 'utf8')
      const compareUrl = `${repoUrl}/compare/${previousTag}...v${version}`
      let tmpData = fs.readFileSync(`scripts/tmp/${tmpChangelog}`, 'utf8')

      LogHelper.success(`Remote origin URL gotten: ${repoUrl}.git`)
      LogHelper.success(`Previous tag gotten: ${previousTag}`)

      if (previousTag !== '') {
        tmpData = tmpData.replace(version, `[${version}](${compareUrl})`)
      }

      fs.writeFile(changelog, `${tmpData}${changelogData}`, (err) => {
        if (err) LogHelper.error(`Failed to write into file: ${err}`)
        else {
          fs.unlinkSync(`scripts/tmp/${tmpChangelog}`)
          LogHelper.success(`${changelog} generated`)
          resolve()
        }
      })
    } catch (e) {
      LogHelper.error(`Error during git commands: ${e}`)
      reject(e)
    }
  })

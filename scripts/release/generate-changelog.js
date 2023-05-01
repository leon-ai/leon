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
      const changelogData = await fs.promises.readFile(changelog, 'utf8')
      const compareUrl = `${repoUrl}/compare/${previousTag}...v${version}`
      let tmpData = await fs.promises.readFile(
        `scripts/tmp/${tmpChangelog}`,
        'utf8'
      )

      LogHelper.success(`Remote origin URL gotten: ${repoUrl}.git`)
      LogHelper.success(`Previous tag gotten: ${previousTag}`)

      if (previousTag !== '') {
        tmpData = tmpData.replace(version, `[${version}](${compareUrl})`)
      }

      try {
        await fs.promises.writeFile(changelog, `${tmpData}${changelogData}`)
        await fs.promises.unlink(`scripts/tmp/${tmpChangelog}`)
        LogHelper.success(`${changelog} generated`)
        resolve()
      } catch (error) {
        LogHelper.error(`Failed to write into file: ${error}`)
      }
    } catch (e) {
      LogHelper.error(`Error during git commands: ${e}`)
      reject(e)
    }
  })

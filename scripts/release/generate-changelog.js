import fs from 'node:fs'

import { execa } from 'execa'

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
      await execa('git-changelog', [
        '--changelogrc',
        '.changelogrc',
        '--template',
        'scripts/assets/CHANGELOG-TEMPLATE.md',
        '--file',
        `scripts/tmp/${tmpChangelog}`,
        '--version_name',
        version
      ])
    } catch (e) {
      LogHelper.error(`Error during git-changelog: ${e}`)
      reject(e)
    }

    try {
      LogHelper.info('Getting remote origin URL...')
      LogHelper.info('Getting previous tag...')

      const remoteOriginResult = await execa('git', [
        'config',
        '--get',
        'remote.origin.url'
      ])
      const gitTagResult = await execa('git', ['tag'])

      const repoUrl = remoteOriginResult.stdout
        .trim()
        .replace(/\.git$/, '')
      const previousTag = gitTagResult.stdout.trim().split('\n').pop() || ''
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

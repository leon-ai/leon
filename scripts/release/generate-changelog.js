import { shell } from 'execa'
import fs from 'fs'

import log from '@/helpers/log'

/**
 * Update version number in files which need version number
 */
export default version => new Promise(async (resolve, reject) => {
  const changelog = 'CHANGELOG.md'
  const tmpChangelog = 'TMP-CHANGELOG.md'

  log.info(`Generating ${changelog}...`)

  try {
    await shell(`git-changelog --changelogrc .changelogrc --template scripts/assets/CHANGELOG-TEMPLATE.md --file scripts/tmp/${tmpChangelog} --version_name ${version}`)
  } catch (e) {
    log.error(`Error during git-changelog: ${e}`)
    reject(e)
  }

  try {
    log.info('Getting remote origin URL...')
    log.info('Getting previous tag...')

    const sh = await shell('git config --get remote.origin.url && git tag | tail -n1')

    const repoUrl = sh.stdout.substr(0, sh.stdout.lastIndexOf('.git'))
    const previousTag = sh.stdout.substr(sh.stdout.indexOf('\n') + 1).trim()
    const changelogData = fs.readFileSync(changelog, 'utf8')
    const compareUrl = `${repoUrl}/compare/${previousTag}...${version}`
    let tmpData = fs.readFileSync(`scripts/tmp/${tmpChangelog}`, 'utf8')

    log.success(`Remote origin URL gotten: ${repoUrl}.git`)
    log.success(`Previous tag gotten: ${previousTag}`)

    if (previousTag !== '') {
      tmpData = tmpData.replace(version, `[${version}](${compareUrl})`)
    }

    fs.writeFile(changelog, `${tmpData}${changelogData}`, (err) => {
      if (err) log.error(`Failed to write into file: ${err}`)
      else {
        fs.unlinkSync(`scripts/tmp/${tmpChangelog}`)
        log.success(`${changelog} generated`)
        resolve()
      }
    })
  } catch (e) {
    log.error(`Error during git commands: ${e}`)
    reject(e)
  }
})

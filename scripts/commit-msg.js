import fs from 'fs'

import log from '@/helpers/log'

/**
 * This script is executed after "git commit" or "git merge" (Git hook https://git-scm.com/docs/githooks#_commit_msg)
 * it ensures the authenticity of commit messages
 */
log.info('Checking commit message...')

const commitEditMsgFile = '.git/COMMIT_EDITMSG'

if (fs.existsSync(commitEditMsgFile)) {
  try {
    const commitMessage = fs.readFileSync(commitEditMsgFile, 'utf8')
    const regex = '(build|BREAKING|chore|ci|docs|feat|fix|perf|refactor|style|test)(\\((web app|server|hotword|skill\\/([\\w-]+)))?\\)?: .{1,50}' // eslint-disable-line no-useless-escape

    if (commitMessage.match(regex) !== null) {
      log.success('Commit message validated')
    } else {
      log.error(`Commit message does not match the format: ${regex}`)
      process.exit(1)
    }
  } catch (e) {
    log.error(e.message)
    process.exit(1)
  }
}

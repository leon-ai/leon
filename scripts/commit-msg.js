import fs from 'node:fs'

import { LogHelper } from '@/helpers/log-helper'

const SCOPES = [
  'agent',
  'context',
  'memory',
  'sessions',
  'llm',
  'tools',
  'runtime',
  'satellite',
  'api',
  'voice',
  'controlled',
  'web app',
  'scripts',
  'aurora',
  'messaging app',
  'built-in command',
  'hotword',
  'python tcp server',
  'bridge/(python|nodejs)',
  'tool/[\\w-]+',
  'skill/[\\w-]+',
  'provider/(llamacpp|sglang|openrouter|zai|deepseek|minimax|openai|anthropic|moonshotai|huggingface|cerebras|groq|celeris)'
]

const COMMIT_SUBJECT_PATTERN = new RegExp(
  '^(build|BREAKING|chore|ci|docs|feat|fix|perf|refactor|style|test)' +
  `(\\((${SCOPES.join('|')})\\))?: .{1,50}$`
)

/**
 * This script is executed after "git commit" or "git merge" (Git hook https://git-scm.com/docs/githooks#_commit_msg)
 * it ensures the authenticity of commit messages
 *
 * @see https://gist.github.com/qoomon/5dfcdf8eec66a051ecd85625518cfd13
 */
;(async () => {
  LogHelper.info('Checking commit message...')

  const commitEditMsgFile = '.git/COMMIT_EDITMSG'

  if (fs.existsSync(commitEditMsgFile)) {
    try {
      const commitMessage = await fs.promises.readFile(
        commitEditMsgFile,
        'utf8'
      )
      const [subject] = commitMessage.split(/\r?\n/, 1)

      if (COMMIT_SUBJECT_PATTERN.test(subject)) {
        LogHelper.success('Commit message validated')
      } else {
        LogHelper.error(
          `Commit message does not match the format: ${COMMIT_SUBJECT_PATTERN}`
        )
        process.exit(1)
      }
    } catch (e) {
      LogHelper.error(e.message)
      process.exit(1)
    }
  }
})()

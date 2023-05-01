import { LogHelper } from '@/helpers/log-helper'
import { LoaderHelper } from '@/helpers/loader-helper'

import updateVersion from './update-version'
import generateChangelog from './generate-changelog'

/**
 * Main entry of the release preparation
 */
;(async () => {
  LoaderHelper.start()
  LogHelper.info('Preparing for release...')

  const { argv } = process
  const version = argv[2].toLowerCase()
  const semverRegex =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(\.(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(\+[0-9a-zA-Z-]+(\.[0-9a-zA-Z-]+)*)?$/

  if (version.match(semverRegex) !== null) {
    try {
      await updateVersion(version)
      await generateChangelog(version)

      LogHelper.success('Hooray! Leon is ready to be released!')
      LoaderHelper.stop()
    } catch (e) {
      LogHelper.error(e)
      LoaderHelper.stop()
    }
  } else {
    LogHelper.error(
      'The version number does match the Semantic Versioning rules (https://semver.org)'
    )
    LoaderHelper.stop()
  }
})()

import { LOG } from '@/helpers/log'
import { LOADER } from '@/helpers/loader'

import updateVersion from './update-version'
import generateChangelog from './generate-changelog'

/**
 * Main entry of the release preparation
 */
;(async () => {
  LOADER.start()
  LOG.info('Preparing for release...')

  const { argv } = process
  const version = argv[2].toLowerCase()
  const semverRegex =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(\.(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(\+[0-9a-zA-Z-]+(\.[0-9a-zA-Z-]+)*)?$/

  if (version.match(semverRegex) !== null) {
    try {
      await updateVersion(version)
      await generateChangelog(version)

      LOG.success('Hooray! Leon is ready to be released!')
      LOADER.stop()
    } catch (e) {
      LOG.error(e)
      LOADER.stop()
    }
  } else {
    LOG.error(
      'The version number does match the Semantic Versioning rules (https://semver.org)'
    )
    LOADER.stop()
  }
})()

import log from '@/helpers/log'
import loader from '@/helpers/loader'

import updateVersion from './update-version'
import generateChangelog from './generate-changelog';

/**
 * main entry of the release preparation
 */
(async () => {
  loader.start()
  log.info('Preparing for release...')

  const { argv } = process
  const version = argv[2].toLowerCase()
  const semverRegex = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(\.(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(\+[0-9a-zA-Z-]+(\.[0-9a-zA-Z-]+)*)?$/

  if (version.match(semverRegex) !== null) {
    try {
      await updateVersion(version)
      await generateChangelog(version)

      log.success('Hooray! Leon is ready to be released!')
      loader.stop()
    } catch (e) {
      log.error(e)
      loader.stop()
    }
  } else {
    log.error('The version number does match the Semantic Versioning rules (https://semver.org)')
    loader.stop()
  }
})()

const fs = require('fs')
const path = require('path')
const os = require('os')

/**
 * Trigger preinstall hook to remove DeepSpeech on Windows
 */

console.info('\x1b[36m➡ %s\x1b[0m', 'Running Leon\'s installation...')

if (os.type().indexOf('Windows') !== -1) {
  const packageJsonPath = path.join(__dirname, '../../package.json')
  const packageJson = require(packageJsonPath)

  console.warn('\x1b[33m❗ %s\x1b[0m', 'The Leon\'s voice offline mode is not available on Windows')
  console.info('\x1b[36m➡ %s\x1b[0m', 'Backing up package.json...')
  fs.copyFileSync('package.json', 'package.json.backup')
  console.log('\x1b[32m✔ %s\x1b[0m', 'package.json has been backed up')

  try {
    if (packageJson?.dependencies.deepspeech) {
      console.info('\x1b[36m➡ %s\x1b[0m', 'Removing DeepSpeech dependency...')

      delete packageJson.dependencies.deepspeech
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2))

      console.log('\x1b[32m✔ %s\x1b[0m', 'DeepSpeech dependency has been removed.')
    }
  } catch (e) {
    console.error('\x1b[31m✖ %s\x1b[0m', 'Failed to remove DeepSpeech dependency')
  }
}

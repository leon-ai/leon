const fs = require('fs')
const os = require('os')
const { execSync } = require('child_process')

/**
 * Trigger preinstall hook to remove DeepSpeech on Windows
 */

if (os.type().indexOf('Windows') !== -1) {
  console.warn('\x1b[33m❗ %s\x1b[0m', 'The Leon\'s voice offline mode is not available on Windows')
  console.info('\x1b[36m➡ %s\x1b[0m', 'Backing up package.json...')
  fs.copyFileSync('package.json', 'package.json.backup')
  console.log('\x1b[32m✔ %s\x1b[0m', 'package.json has been backed up')
  console.info('\x1b[36m➡ %s\x1b[0m', 'Removing DeepSpeech dependency... Please wait, this might take several minutes...')
  execSync('npm uninstall --save deepspeech')
  console.log('\x1b[32m✔ %s\x1b[0m', 'DeepSpeech dependency has been removed.')
}

console.info('\x1b[36m➡ %s\x1b[0m', 'Running Leon\'s installation...')

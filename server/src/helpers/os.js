import getos from 'getos'
import o from 'os'

import { promisify } from 'util'

/** change from a callback function to promise */
const getosPromise = promisify(getos)

const os = { }

/**
 * Returns information about your OS
 */
os.get = async () => {
  let type = 'unknown'
  let name = ''
  let distro

  const result = await getosPromise()
  const osName = result.os.toLowerCase()

  if (osName.indexOf('windows') !== -1) {
    type = 'windows'
    name = 'Windows'
  } else if (osName === 'darwin') {
    type = 'macos'
    name = 'macOS'
  } else if (osName === 'linux') {
    type = 'linux'
    name = 'Linux'
    // e.g "Arch Linux". Linux Examples https://github.com/retrohacker/getos/blob/master/os.json
    distro = result.dist
  }

  return { type, name, distro }
}

/**
 * Returns the number of cores on your machine
 */
os.cpus = () => o.cpus()

export default os

'use strict'

import o from 'os'

const os = { }

/**
 * Returns information about your OS
 */
os.get = () => {
  let type = 'unknown'
  let name = ''

  if (o.type().indexOf('Windows') !== -1) {
    type = 'windows'
    name = 'Windows'
  } else if (o.type() === 'Darwin') {
    type = 'macos'
    name = 'macOS'
  } else if (o.type() === 'Linux') {
    type = 'linux'
    name = 'Linux'
  }

  return { type, name }
}

/**
 * Returns the number of cores on your machine
 */
os.cpus = () => o.cpus()

export default os

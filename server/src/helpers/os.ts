import nodeOS from 'node:os'

export type GetOSType = 'windows' | 'macos' | 'linux' | 'unknown'
export type GetOSName = 'Windows' | 'macOS' | 'Linux' | 'Unknown'

export interface GetOSInformation {
  type: GetOSType
  name: GetOSName
}

/**
 * Returns information about your OS
 */
export const getOSInformation = (): GetOSInformation => {
  let type: GetOSType = 'unknown'
  let name: GetOSName = 'Unknown'
  if (nodeOS.type().indexOf('Windows') !== -1) {
    type = 'windows'
    name = 'Windows'
  } else if (nodeOS.type() === 'Darwin') {
    type = 'macos'
    name = 'macOS'
  } else if (nodeOS.type() === 'Linux') {
    type = 'linux'
    name = 'Linux'
  }
  return { type, name }
}

/**
 * Returns the number of cores on your machine
 */
export const getNumberOfCPUCores = (): number => {
  return nodeOS.cpus().length
}

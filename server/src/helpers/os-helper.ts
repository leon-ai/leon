import os from 'node:os'

type OSType = 'windows' | 'macos' | 'linux' | 'unknown'
type OSName = 'Windows' | 'macOS' | 'Linux' | 'Unknown'

interface GetInformation {
  type: OSType
  name: OSName
}

export class OSHelper {
  /**
   * Get information about your OS
   * @example getInformation() // { type: 'linux', name: 'Linux' }
   */
  public static getInformation(): GetInformation {
    let type: OSType = 'unknown'
    let name: OSName = 'Unknown'

    if (os.type().indexOf('Windows') !== -1) {
      type = 'windows'
      name = 'Windows'
    } else if (os.type() === 'Darwin') {
      type = 'macos'
      name = 'macOS'
    } else if (os.type() === 'Linux') {
      type = 'linux'
      name = 'Linux'
    }

    return { type, name }
  }

  /**
   * Get the number of cores on your machine
   * @example getNumberOfCPUCores() // 8
   */
  public static getNumberOfCPUCores(): number {
    return os.cpus().length
  }
}

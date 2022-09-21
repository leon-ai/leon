import nodeOS from 'node:os'

type OSType = 'windows' | 'macos' | 'linux' | 'unknown'
type OSName = 'Windows' | 'macOS' | 'Linux' | 'Unknown'

interface GetInformation {
  type: OSType
  name: OSName
}

class OperatingSystem {
  private static instance: OperatingSystem

  private constructor() {
    // Singleton
  }

  public static getInstance() {
    if (OperatingSystem.instance == null) {
      OperatingSystem.instance = new OperatingSystem()
    }

    return OperatingSystem.instance
  }

  /**
   * Get information about your OS
   * @example getInformation() // { type: 'linux', name: 'Linux' }
   */
  public getInformation(): GetInformation {
    let type: OSType = 'unknown'
    let name: OSName = 'Unknown'

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
   * Get the number of cores on your machine
   * @example getNumberOfCPUCores() // 8
   */
  public getNumberOfCPUCores() {
    return nodeOS.cpus().length
  }
}

export const OS = OperatingSystem.getInstance()

import os from 'node:os'

export enum OSTypes {
  Windows = 'windows',
  MacOS = 'macos',
  Linux = 'linux',
  Unknown = 'unknown'
}
export enum CPUArchitectures {
  X64 = 'x64',
  ARM64 = 'arm64'
}
enum OSNames {
  Windows = 'Windows',
  MacOS = 'macOS',
  Linux = 'Linux',
  Unknown = 'Unknown'
}
enum BinaryFolderNames {
  Linux64Bit = 'linux-x86_64', // Linux 64-bit (Intel)
  LinuxARM64 = 'linux-aarch64', // Linux 64-bit (ARM)
  MacOS64Bit = 'macosx-x86_64', // Apple 64-bit (Intel)
  MacOSARM64 = 'macosx-arm64', // Apple silicon (64-bit) (ARM - M1)
  Windows64Bit = 'win-amd64', // Windows 64-bit
  Unknown = 'unknown'
}

interface GetInformation {
  type: OSTypes
  name: OSNames
  platform: NodeJS.Platform
  cpuArchitecture: CPUArchitectures
}

type PartialInformation = {
  [key in NodeJS.Platform]?: {
    type: OSTypes
    name: OSNames
  }
}

export class OSHelper {
  /**
   * Get information about your OS
   * N.B. Node.js returns info based on the compiled binary we are running on. Not based our machine hardware
   * @see https://github.com/nodejs/node/blob/main/BUILDING.md#supported-platforms
   * @example getInformation() // { type: 'linux', name: 'Linux', platform: 'linux', cpuArchitecture: 'x64' }
   */
  public static getInformation(): GetInformation {
    const platform = os.platform()
    const cpuArchitecture = os.arch() as CPUArchitectures

    const information: PartialInformation = {
      linux: {
        type: OSTypes.Linux,
        name: OSNames.Linux
      },
      darwin: {
        type: OSTypes.MacOS,
        name: OSNames.MacOS
      },
      // Node.js returns "win32" for both 32-bit and 64-bit versions of Windows
      win32: {
        type: OSTypes.Windows,
        name: OSNames.Windows
      }
    }

    return {
      ...(information[platform] || {
        type: OSTypes.Unknown,
        name: OSNames.Unknown
      }),
      platform,
      cpuArchitecture
    }
  }

  /**
   * Get binaries folder name based on the platform and CPU architecture
   * Comply with the naming convention of Python sysconfig.get_platform()
   * @see https://github.com/python/cpython/blob/main/Lib/sysconfig.py
   * @example getBinariesFolderName() // 'linux-x86_64'
   */
  public static getBinariesFolderName(): BinaryFolderNames {
    const { type, cpuArchitecture } = this.getInformation()

    if (type === OSTypes.Linux) {
      if (cpuArchitecture === CPUArchitectures.X64) {
        return BinaryFolderNames.Linux64Bit
      }

      return BinaryFolderNames.LinuxARM64
    }

    if (type === OSTypes.MacOS) {
      const cpuCores = os.cpus()
      const isM1 = cpuCores[0]?.model.includes('Apple')

      if (isM1 || cpuArchitecture === CPUArchitectures.ARM64) {
        return BinaryFolderNames.MacOSARM64
      }

      return BinaryFolderNames.MacOS64Bit
    }

    if (type === OSTypes.Windows) {
      return BinaryFolderNames.Windows64Bit
    }

    return BinaryFolderNames.Unknown
  }

  /**
   * Get the number of cores on your machine
   * @example getNumberOfCPUCores() // 8
   */
  public static getNumberOfCPUCores(): number {
    return os.cpus().length
  }
}

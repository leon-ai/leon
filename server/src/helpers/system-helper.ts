import os from 'node:os'
import { execFileSync } from 'node:child_process'

import type { Llama } from 'node-llama-cpp'

import { OSTypes, CPUArchitectures } from '@/types'

const BYTES_PER_GIB = 1_024 * 1_024 * 1_024
const MACOS_DEFAULT_VM_STAT_PAGE_SIZE_BYTES = 16_384
const MACOS_VM_STAT_TIMEOUT_MS = 3_000
const MACOS_VM_STAT_PAGE_SIZE_REGEX = /page size of (\d+) bytes/
const MACOS_VM_STAT_PAGE_LINE_REGEX = /^Pages ([^:]+):\s+(\d+)\./
const MACOS_RECLAIMABLE_VM_STAT_PAGE_NAMES = [
  'free',
  'inactive',
  'speculative',
  'purgeable'
]
const MINIMUM_LOCAL_LLM_VRAM_GB = 6
const MINIMUM_LOCAL_LLM_RAM_GB = 8

enum OSNames {
  Windows = 'Windows',
  MacOS = 'macOS',
  Linux = 'Linux',
  Unknown = 'Unknown'
}
enum GraphicsComputeAPIs {
  CPU = 'cpu',
  CUDA = 'cuda',
  Vulkan = 'vulkan',
  Metal = 'metal'
}
export enum BinaryFolderNames {
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

export class SystemHelper {
  private static hardwareInspectionLlamaPromise: Promise<Llama | null> | null =
    null

  private static async getHardwareInspectionLlama(): Promise<Llama | null> {
    if (!this.hardwareInspectionLlamaPromise) {
      this.hardwareInspectionLlamaPromise = (async (): Promise<Llama | null> => {
        try {
          const { getLlama, LlamaLogLevel } = await Function(
            'return import("node-llama-cpp")'
          )()

          return await getLlama({
            logLevel: LlamaLogLevel.disabled
          })
        } catch {
          return null
        }
      })()
    }

    return this.hardwareInspectionLlamaPromise
  }

  private static async resolveLlamaAPI(
    llama?: Llama
  ): Promise<Llama | null> {
    if (llama) {
      return llama
    }

    return this.getHardwareInspectionLlama()
  }

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
   * Get the number of cores on the machine
   * @example getNumberOfCPUCores() // 8
   */
  public static getNumberOfCPUCores(): number {
    return os.cpus().length
  }

  /**
   * Get the total amount of memory (in GB) on the machine
   * @example getTotalRAM() // 4
   */
  public static getTotalRAM(): number {
    return Number((os.totalmem() / BYTES_PER_GIB).toFixed(2))
  }

  /**
   * Get the amount of free memory (in GB) on the machine
   * @example getFreeRAM() // 6
   */
  public static getFreeRAM(): number {
    return Number((this.getFreeRAMInBytes() / BYTES_PER_GIB).toFixed(2))
  }

  /**
   * Get the amount of free memory (in bytes) on the machine
   * @example getFreeRAMInBytes() // 6442450944
   */
  public static getFreeRAMInBytes(): number {
    if (this.isMacOS()) {
      return this.getMacOSAvailableMemoryInBytes() || os.freemem()
    }

    return os.freemem()
  }

  /**
   * Get macOS available memory from reclaimable vm_stat pages
   * @example getMacOSAvailableMemoryInBytes() // 6442450944
   */
  private static getMacOSAvailableMemoryInBytes(): number | null {
    try {
      const output = execFileSync('vm_stat', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: MACOS_VM_STAT_TIMEOUT_MS
      })

      return this.parseMacOSAvailableMemoryInBytes(output)
    } catch {
      return null
    }
  }

  /**
   * Parse macOS available memory from vm_stat output
   * @example parseMacOSAvailableMemoryInBytes('Mach Virtual Memory Statistics: ...') // 6442450944
   */
  private static parseMacOSAvailableMemoryInBytes(
    vmStatOutput: string
  ): number | null {
    const pageSizeMatch = vmStatOutput.match(MACOS_VM_STAT_PAGE_SIZE_REGEX)
    const pageSize = pageSizeMatch?.[1]
      ? Number(pageSizeMatch[1])
      : MACOS_DEFAULT_VM_STAT_PAGE_SIZE_BYTES
    const pageCounts = new Map<string, number>()

    for (const line of vmStatOutput.split('\n')) {
      const lineMatch = line.trim().match(MACOS_VM_STAT_PAGE_LINE_REGEX)

      if (!lineMatch?.[1] || !lineMatch[2]) {
        continue
      }

      pageCounts.set(lineMatch[1], Number(lineMatch[2]))
    }

    const reclaimablePages = MACOS_RECLAIMABLE_VM_STAT_PAGE_NAMES.reduce(
      (totalPages, pageName) => totalPages + (pageCounts.get(pageName) || 0),
      0
    )

    if (!Number.isFinite(pageSize) || reclaimablePages <= 0) {
      return null
    }

    return reclaimablePages * pageSize
  }

  /**
   * Get the Node.js version of the current process
   * @example getNodeJSVersion() // '18.15.0'
   */
  public static getNodeJSVersion(): string {
    return process.versions.node || '0.0.0'
  }

  /**
   * Get the npm version used to run the current process
   * @example getNPMVersion() // '9.5.0'
   */
  public static getNPMVersion(): string {
    return (
      process.env['npm_config_user_agent']?.split('/')[1]?.split(' ')[0] ||
      '0.0.0'
    )
  }

  /**
   * Replace all current session profile name occurrences with {username} placeholder
   * @example sanitizeUsername('/home/louis') // '/home/{username}'
   */
  public static sanitizeUsername(str: string): string {
    const { username } = os.userInfo()

    return str.replace(new RegExp(username, 'g'), '{username}')
  }

  /**
   * Check if the current OS is Windows
   * @example isWindows() // false
   */
  public static isWindows(): boolean {
    const { type } = this.getInformation()

    return type === OSTypes.Windows
  }

  /**
   * Check if the current OS is macOS
   * @example isMacOS() // false
   */
  public static isMacOS(): boolean {
    const { type } = this.getInformation()

    return type === OSTypes.MacOS
  }

  /**
   * Check if the current OS is Linux
   * @example isLinux() // true
   */
  public static isLinux(): boolean {
    const { type } = this.getInformation()

    return type === OSTypes.Linux
  }

  /**
   * Get the names of the GPU devices on the machine
   * @example getGPUDeviceNames() // ['Apple M1 Pro']
   */
  public static async getGPUDeviceNames(llama?: Llama): Promise<string[]> {
    const llamaAPI = await this.resolveLlamaAPI(llama)

    if (llamaAPI) {
      return llamaAPI.getGpuDeviceNames()
    }

    return []
  }

  /**
   * Check if the machine has a GPU
   * @example hasGPU() // true
   */
  public static async hasGPU(llama?: Llama): Promise<boolean> {
    const llamaAPI = await this.resolveLlamaAPI(llama)

    if (llamaAPI) {
      return !!llamaAPI.gpu
    }

    return false
  }

  /**
   * Get the graphics compute API used by the machine
   * @example getGraphicsComputeAPI() // 'cuda'
   */
  public static async getGraphicsComputeAPI(
    llama?: Llama
  ): Promise<GraphicsComputeAPIs> {
    const llamaAPI = await this.resolveLlamaAPI(llama)

    if (llamaAPI && llamaAPI.gpu) {
      return llamaAPI.gpu as GraphicsComputeAPIs
    }

    return GraphicsComputeAPIs.CPU
  }

  /**
   * Get the amount of used VRAM (in GB) on the machine
   * @example getUsedVRAM() // 6.04
   */
  public static async getUsedVRAM(llama?: Llama): Promise<number> {
    const llamaAPI = await this.resolveLlamaAPI(llama)

    if (llamaAPI) {
      const vramState = await llamaAPI.getVramState()

      return Number((vramState.used / (1_024 * 1_024 * 1_024)).toFixed(2))
    }

    return 0
  }

  /**
   * Get the total amount of VRAM (in GB) on the machine
   * @example getTotalVRAM() // 12
   */
  public static async getTotalVRAM(llama?: Llama): Promise<number> {
    const llamaAPI = await this.resolveLlamaAPI(llama)

    if (llamaAPI) {
      const vramState = await llamaAPI.getVramState()

      return Number((vramState.total / (1_024 * 1_024 * 1_024)).toFixed(2))
    }

    return 0
  }

  /**
   * Check if the machine can support a local LLM based on VRAM or system RAM
   * @example canSupportLocalLLM() // true
   */
  public static async canSupportLocalLLM(llama?: Llama): Promise<boolean> {
    return (
      (await this.getTotalVRAM(llama)) >= MINIMUM_LOCAL_LLM_VRAM_GB ||
      this.getTotalRAM() >= MINIMUM_LOCAL_LLM_RAM_GB
    )
  }

  /**
   * Get the amount of free VRAM (in GB) on the machine
   * @example getFreeVRAM() // 6
   */
  public static async getFreeVRAM(llama?: Llama): Promise<number> {
    const llamaAPI = await this.resolveLlamaAPI(llama)

    if (llamaAPI) {
      const vramState = await llamaAPI.getVramState()

      return Number((vramState.free / (1_024 * 1_024 * 1_024)).toFixed(2))
    }

    return 0
  }
}

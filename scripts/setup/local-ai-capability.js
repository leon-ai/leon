import { CPUArchitectures } from '@/types'
import { SystemHelper } from '@/helpers/system-helper'

/**
 * Inspect whether this machine is a good fit for Leon's local AI setup.
 */
export default async function inspectLocalAICapability() {
  const isLinux = SystemHelper.isLinux()
  const [hasProbedGPU, gpuDeviceNames, graphicsComputeAPI, probedVRAM, nvidia] =
    await Promise.all([
      SystemHelper.hasGPU(),
      SystemHelper.getGPUDeviceNames(),
      SystemHelper.getGraphicsComputeAPI(),
      SystemHelper.getTotalVRAM(),
      isLinux ? SystemHelper.getNvidiaGPUInfo() : null
    ])

  const hasGPU = hasProbedGPU || Boolean(nvidia)
  const totalVRAM = Math.max(probedVRAM, nvidia?.totalVRAM ?? 0)
  const isLinuxARM64 = isLinux &&
    SystemHelper.getInformation().cpuArchitecture === CPUArchitectures.ARM64
  const canInstallLocalAI =
    (!isLinuxARM64 || hasGPU) && await SystemHelper.canSupportLocalLLM(totalVRAM)

  return {
    hasGPU,
    gpuDeviceNames: [...new Set([...gpuDeviceNames, ...(nvidia?.names ?? [])])],
    graphicsComputeAPI: nvidia ? 'cuda' : graphicsComputeAPI,
    totalVRAM,
    canInstallLocalAI
  }
}

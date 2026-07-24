import { CPUArchitectures } from '@/types'
import { SystemHelper } from '@/helpers/system-helper'

/**
 * Inspect whether this machine is a good fit for Leon's local AI setup.
 */
export default async function inspectLocalAICapability() {
  let llama = null

  try {
    const { getLlama, LlamaLogLevel } = await Function(
      'return import("node-llama-cpp")'
    )()

    llama = await getLlama({
      logLevel: LlamaLogLevel.disabled
    })
  } catch {
    llama = null
  }

  const [hasGPU, gpuDeviceNames, graphicsComputeAPI, totalVRAM, canSupportLLM] =
    await Promise.all([
      SystemHelper.hasGPU(llama || undefined),
      SystemHelper.getGPUDeviceNames(llama || undefined),
      SystemHelper.getGraphicsComputeAPI(llama || undefined),
      SystemHelper.getTotalVRAM(llama || undefined),
      SystemHelper.canSupportLocalLLM(llama || undefined)
    ])

  const isLinuxARM64 =
    SystemHelper.isLinux() &&
    SystemHelper.getInformation().cpuArchitecture === CPUArchitectures.ARM64

  const canInstallLocalAI =
    (!isLinuxARM64 || (hasGPU && graphicsComputeAPI === 'cuda')) &&
    canSupportLLM

  return {
    hasGPU,
    gpuDeviceNames,
    graphicsComputeAPI,
    totalVRAM,
    canInstallLocalAI
  }
}

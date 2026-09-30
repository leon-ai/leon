import type { HardwareInspectionSnapshot } from './system-helper'

/**
 * Read a small hardware snapshot without retaining native GPU state in Core.
 */
async function inspectHardware(): Promise<HardwareInspectionSnapshot> {
  const { getLlama, LlamaLogLevel } = await import('node-llama-cpp')
  const llama = await getLlama({
    logLevel: LlamaLogLevel.disabled,
    // Inspect installed backends only; a status request must never build them.
    build: 'never',
    skipDownload: true,
    progressLogs: false
  })

  try {
    const [gpuDeviceNames, vram] = await Promise.all([
      llama.getGpuDeviceNames(),
      llama.getVramState()
    ])

    return { gpu: llama.gpu, gpuDeviceNames, vram }
  } finally {
    await llama.dispose()
  }
}

let snapshot: HardwareInspectionSnapshot | null = null

try {
  snapshot = await inspectHardware()
} catch {
  // Missing or unsupported GPU backends keep the existing CPU fallback.
}

// Exiting releases GPU libraries that native disposal cannot unload reliably.
process.stdout.write(JSON.stringify(snapshot), () => {
  process.exit(0)
})

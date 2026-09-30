import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import {
  SystemHelper,
  type HardwareInspectionSnapshot
} from '@/helpers/system-helper'
import { RuntimeHelper } from '@/helpers/runtime-helper'

const BYTES_PER_GIB = 1_024 * 1_024 * 1_024
const execFileAsync = promisify(execFile)

describe('hardware inspection worker', () => {
  it('returns hardware information without loading llama.cpp into the parent', async () => {
    const mapsBefore = process.platform === 'linux'
      ? fs.readFileSync('/proc/self/maps', 'utf8')
      : null

    // Compare with the worker directly so a broken launcher cannot silently
    // pass this check by returning the CPU fallback on GPU-capable machines.
    const { stdout } = await execFileAsync(RuntimeHelper.getNodeBinPath(), [
      fileURLToPath(import.meta.resolve('tsx/cli')),
      fileURLToPath(
        new URL('../../../server/src/helpers/hardware-inspection-worker.ts', import.meta.url)
      )
    ], {
      timeout: 15_000,
      killSignal: 'SIGKILL',
      windowsHide: true
    })
    const snapshot = JSON.parse(stdout) as HardwareInspectionSnapshot | null
    const [names, gpu, total, free, used] = await Promise.all([
      SystemHelper.getGPUDeviceNames(),
      SystemHelper.getGraphicsComputeAPI(),
      SystemHelper.getTotalVRAM(),
      SystemHelper.getFreeVRAM(),
      SystemHelper.getUsedVRAM()
    ])

    expect(names).toEqual(snapshot?.gpuDeviceNames || [])
    expect(gpu).toBe(snapshot?.gpu || 'cpu')
    expect(total).toBe(Number(
      ((snapshot?.vram.total || 0) / BYTES_PER_GIB).toFixed(2)
    ))
    expect([total, free, used].every((value) =>
      Number.isFinite(value) && value >= 0
    )).toBe(true)

    if (mapsBefore !== null) {
      const mapsAfter = fs.readFileSync('/proc/self/maps', 'utf8')
      const gpuMappings = (maps: string): string[] => maps.split('\n')
        .filter((line) => line.includes('llama-addon.node') ||
          line.includes('libggml-cuda') || line.includes('/dev/nvidia'))

      expect(gpuMappings(mapsAfter)).toEqual(gpuMappings(mapsBefore))
    }
  })
})

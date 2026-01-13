import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { CUDA_RUNTIME_PATH } from '@bridge/constants'
import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { getPlatformName } from '@sdk/utils'

const MODEL_NAME = 'ultimate-vocal-remover-onnx'

interface VocalSeparationTask {
  audio_path: string
  vocal_output_path: string
  instrumental_output_path: string
  aggression?: number
}

export default class UltimateVocalRemoverONNXTool extends Tool {
  private static readonly TOOLKIT = 'music_audio'
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    // Load configuration from central toolkits directory
    this.config = ToolkitConfig.load(
      UltimateVocalRemoverONNXTool.TOOLKIT,
      this.toolName
    )
  }

  get toolName(): string {
    // Use the actual config name for toolkit lookup
    return 'ultimate_vocal_remover_onnx'
  }

  get toolkit(): string {
    return UltimateVocalRemoverONNXTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Separate vocals from audio using Ultimate Vocal Remover ONNX
   * @param tasks Array of vocal separation tasks or a single task
   * @param cudaRuntimePath Optional path to CUDA runtime for GPU acceleration (auto-detected if not provided)
   * @returns A promise that resolves when vocal separation is complete
   */
  async separateVocals(
    tasks: VocalSeparationTask | VocalSeparationTask[],
    cudaRuntimePath?: string
  ): Promise<void> {
    try {
      // Normalize tasks to array
      const taskArray = Array.isArray(tasks) ? tasks : [tasks]

      // Get model path using the generic resource system
      const resourceDir = await this.getResourcePath(MODEL_NAME)
      const modelPath = path.join(resourceDir, 'UVR-MDX-NET-Inst_HQ_3.onnx')

      // Create a temporary JSON file for the tasks
      const tempDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'ultimate_vocal_remover_onnx_tasks_')
      )
      const jsonFilePath = path.join(tempDir, 'tasks.json')

      await fs.promises.writeFile(
        jsonFilePath,
        JSON.stringify(taskArray, null, 2),
        'utf8'
      )

      const args = [
        '--function',
        'separate_vocals',
        '--json_file',
        jsonFilePath,
        '--resource_path',
        modelPath
      ]

      // Auto-detect CUDA runtime path if not provided
      const platformName = getPlatformName()
      const shouldUseCuda =
        platformName === 'linux-x86_64' || platformName === 'win-amd64'
      const finalCudaRuntimePath =
        cudaRuntimePath ?? (shouldUseCuda ? CUDA_RUNTIME_PATH : undefined)

      if (finalCudaRuntimePath) {
        args.push('--cuda_runtime_path', finalCudaRuntimePath)
      }

      await this.executeCommand({
        binaryName: 'ultimate_vocal_remover_onnx',
        args,
        options: { sync: true }
      })

      // Clean up temporary files
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    } catch (error: unknown) {
      throw new Error(`Vocal separation failed: ${(error as Error).message}`)
    }
  }
}

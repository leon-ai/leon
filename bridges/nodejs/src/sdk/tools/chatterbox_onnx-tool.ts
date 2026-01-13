import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { CUDA_RUNTIME_PATH } from '@bridge/constants'
import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { getPlatformName } from '@sdk/utils'

const MODEL_NAME = 'chatterbox-multilingual-onnx'

interface SynthesisTask {
  text: string
  target_language?: string
  audio_path: string
  // @see https://github.com/leon-ai/leon-binaries/tree/main/bins/chatterbox_onnx/default_voices
  voice_name?: string
  speaker_reference_path?: string
  cfg_strength?: number
  exaggeration?: number
  temperature?: number
}

export default class ChatterboxONNXTool extends Tool {
  private static readonly TOOLKIT = 'music_audio'
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    // Load configuration from central toolkits directory
    this.config = ToolkitConfig.load(ChatterboxONNXTool.TOOLKIT, this.toolName)
  }

  get toolName(): string {
    // Use the actual config name for toolkit lookup
    return 'chatterbox_onnx'
  }

  get toolkit(): string {
    return ChatterboxONNXTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Synthesize speech from text using Chatterbox ONNX
   * @param tasks Array of synthesis tasks or a single task
   * @param cudaRuntimePath Optional path to CUDA runtime for GPU acceleration (auto-detected if not provided)
   * @returns A promise that resolves when synthesis is complete
   */
  async synthesizeSpeechToFiles(
    tasks: SynthesisTask | SynthesisTask[],
    cudaRuntimePath?: string
  ): Promise<void> {
    try {
      // Normalize tasks to array
      const taskArray = Array.isArray(tasks) ? tasks : [tasks]

      // Get model path using the generic resource system
      const modelPath = await this.getResourcePath(MODEL_NAME)

      // Create a temporary JSON file for the tasks
      const tempDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'chatterbox_onnx_tasks_')
      )
      const jsonFilePath = path.join(tempDir, 'tasks.json')

      await fs.promises.writeFile(
        jsonFilePath,
        JSON.stringify(taskArray, null, 2),
        'utf8'
      )

      const args = [
        '--function',
        'synthesize_speech',
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
        binaryName: 'chatterbox_onnx',
        args,
        options: { sync: true }
      })

      // Clean up temporary files
      await fs.promises.rm(tempDir, { recursive: true, force: true })
    } catch (error: unknown) {
      throw new Error(`Speech synthesis failed: ${(error as Error).message}`)
    }
  }
}

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { NVIDIA_LIBS_PATH } from '@bridge/constants'
import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { getPlatformName } from '@sdk/utils'

const MODEL_NAME = 'chatterbox-multilingual-onnx'
const DEFAULT_MAX_CHARS = 272 // Character limit to avoid hallucination
const DEFAULT_SETTINGS: Record<string, unknown> = {}
const REQUIRED_SETTINGS: string[] = []

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
  // Control automatic text splitting (default: true)
  auto_split?: boolean
}

/**
 * Split text at natural punctuation boundaries to avoid hallucination.
 *
 * This function ensures no text segment exceeds maxChars by breaking at
 * punctuation marks when possible, falling back to spaces or forced splits.
 *
 * @param text The text to split
 * @param maxChars Maximum characters per segment (default: 272)
 * @returns Array of text chunks split at natural boundaries
 */
function splitTextAtPunctuation(
  text: string,
  maxChars: number = DEFAULT_MAX_CHARS
): string[] {
  const trimmedText = text.trim()
  if (trimmedText.length <= maxChars) {
    return [trimmedText]
  }

  const chunks: string[] = []
  let remaining = trimmedText

  while (remaining.length > maxChars) {
    // Get segment up to maxChars
    const segment = remaining.substring(0, maxChars + 1)

    // Look for punctuation followed by space (natural break)
    const punctuationPattern = /[.!?,;:]\s/g
    let lastMatch = -1
    let match: RegExpExecArray | null

    while ((match = punctuationPattern.exec(segment)) !== null) {
      lastMatch = match.index + 1 // Include the punctuation but not the space
    }

    // Check if we found punctuation in a reasonable position (latter half)
    if (lastMatch > maxChars * 0.5) {
      chunks.push(remaining.substring(0, lastMatch).trim())
      remaining = remaining.substring(lastMatch).trim()
      continue
    }

    // No good punctuation found, look for last space
    const lastSpace = segment.substring(0, maxChars).lastIndexOf(' ')
    if (lastSpace > maxChars * 0.3) {
      chunks.push(remaining.substring(0, lastSpace).trim())
      remaining = remaining.substring(lastSpace).trim()
    } else {
      // Force split at maxChars
      chunks.push(remaining.substring(0, maxChars).trim())
      remaining = remaining.substring(maxChars).trim()
    }
  }

  if (remaining.length > 0) {
    chunks.push(remaining.trim())
  }

  return chunks
}

export default class ChatterboxONNXTool extends Tool {
  private static readonly TOOLKIT = 'music_audio'
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    // Load configuration from central toolkits directory
    this.config = ToolkitConfig.load(ChatterboxONNXTool.TOOLKIT, this.toolName)
    const toolSettings = ToolkitConfig.loadToolSettings(
      ChatterboxONNXTool.TOOLKIT,
      this.toolName,
      DEFAULT_SETTINGS
    )
    this.settings = toolSettings
    this.requiredSettings = REQUIRED_SETTINGS
    this.checkRequiredSettings(this.toolName)
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
   *
   * By default, automatically splits long text (>272 chars) at punctuation boundaries
   * to prevent hallucination. Split segments generate separate audio files with
   * _part_N suffixes (e.g., output_part_0.wav, output_part_1.wav).
   *
   * @param tasks Array of synthesis tasks or a single task
   * @param cudaRuntimePath Optional path to CUDA runtime for GPU acceleration (auto-detected if not provided)
   * @returns A promise that resolves with the list of processed tasks (may include split tasks)
   */
  async synthesizeSpeechToFiles(
    tasks: SynthesisTask | SynthesisTask[],
    cudaRuntimePath?: string
  ): Promise<Omit<SynthesisTask, 'auto_split'>[]> {
    try {
      // Normalize tasks to array
      const taskArray = Array.isArray(tasks) ? tasks : [tasks]

      // Process tasks: split long text into multiple tasks with _part_N suffixes
      const tasksToSynthesize: Omit<SynthesisTask, 'auto_split'>[] = []

      for (const task of taskArray) {
        const autoSplit = task.auto_split !== undefined ? task.auto_split : true // Default: enabled
        const text = task.text.trim()
        const maxChars = DEFAULT_MAX_CHARS

        // If auto_split disabled or text is short, pass through as-is
        if (!autoSplit || text.length <= maxChars) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { auto_split, ...cleanTask } = task
          tasksToSynthesize.push(cleanTask)
          continue
        }

        // Split long text at punctuation boundaries
        const textChunks = splitTextAtPunctuation(text, maxChars)

        // If only one chunk after splitting, no need for special handling
        if (textChunks.length === 1) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { auto_split, ...cleanTask } = task
          tasksToSynthesize.push(cleanTask)
          continue
        }

        // Multiple chunks: create separate tasks with _part_N suffixes
        const audioPath = task.audio_path
        const parsedPath = path.parse(audioPath)
        const basePath = path.join(parsedPath.dir, parsedPath.name)
        const ext = parsedPath.ext

        for (let i = 0; i < textChunks.length; i += 1) {
          const chunk = textChunks[i]
          if (!chunk) continue

          const baseTask = {
            ...task,
            text: chunk,
            audio_path: `${basePath}_part_${i}${ext}`
          }
          delete baseTask.auto_split

          tasksToSynthesize.push(baseTask)
        }
      }

      // Get model path using the generic resource system
      const modelPath = await this.getResourcePath(MODEL_NAME)

      // Create a temporary JSON file for the tasks
      const tempDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'chatterbox_onnx_tasks_')
      )
      const jsonFilePath = path.join(tempDir, 'tasks.json')

      await fs.promises.writeFile(
        jsonFilePath,
        JSON.stringify(tasksToSynthesize, null, 2),
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
        cudaRuntimePath ?? (shouldUseCuda ? NVIDIA_LIBS_PATH : undefined)

      if (finalCudaRuntimePath) {
        args.push('--cuda_runtime_path', finalCudaRuntimePath)
      }

      await this.executeCommand({
        binaryName: 'chatterbox_onnx',
        args,
        options: { sync: true }
      })

      // Return the processed tasks so caller knows which files were created
      return tasksToSynthesize
    } catch (error: unknown) {
      throw new Error(`Speech synthesis failed: ${(error as Error).message}`)
    }
  }
}

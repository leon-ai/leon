import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { TranscriptionOutput } from '@tools/music_audio/transcription-schema'
import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { NVIDIA_LIBS_PATH, PYTORCH_TORCH_PATH } from '@bridge/constants'

type Qwen3ASRTranscriptionOutput = string

const MODEL_NAME = 'qwen3-asr-1.7b'
const FORCED_ALIGNER_MODEL_NAME = 'qwen3-forcedaligner-0.6b'
const DEFAULT_SETTINGS: Record<string, unknown> = {}
const REQUIRED_SETTINGS: string[] = []

interface Qwen3ASRTask {
  audio_path: string
  output_path?: string
}

export default class Qwen3ASRTool extends Tool {
  private static readonly TOOLKIT = 'music_audio'
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    // Load configuration from central toolkits directory
    this.config = ToolkitConfig.load(Qwen3ASRTool.TOOLKIT, this.toolName)
    const toolSettings = ToolkitConfig.loadToolSettings(
      Qwen3ASRTool.TOOLKIT,
      this.toolName,
      DEFAULT_SETTINGS
    )
    this.settings = toolSettings
    this.requiredSettings = REQUIRED_SETTINGS
    this.checkRequiredSettings(this.toolName)
  }

  get toolName(): string {
    // Use the actual config name for toolkit lookup
    return 'qwen3_asr'
  }

  get toolkit(): string {
    return Qwen3ASRTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Transcribe audio to a file using Qwen3-ASR
   * @param inputPath The file path of the audio to be transcribed
   * @param outputPath The desired file path for the transcription output
   * @param device Device to use for processing (cpu, cuda, auto)
   * @param batchSize Batch size for processing
   * @param language Language code for transcription (auto, en, fr, etc.)
   * @param returnTimestamps Whether to return timestamps in output
   * @param useForcedAligner Whether to use the forced aligner model
   * @param cudaRuntimePath Path to CUDA runtime directory (Linux/Windows only)
   * @param torchPath Path to PyTorch installation directory
   * @param chunkDuration Chunk duration in seconds for long audio
   * @param cpuBatchSize CPU batch size for long audio
   * @returns A promise that resolves with the path to the transcription file
   */
  async transcribeToFile(
    inputPath: string,
    outputPath: string,
    device = 'auto',
    batchSize = 4,
    language = 'auto',
    returnTimestamps = true,
    useForcedAligner = true,
    cudaRuntimePath?: string,
    torchPath?: string,
    chunkDuration = 30,
    cpuBatchSize?: number
  ): Promise<string> {
    let tempDir: string | null = null
    let jsonFilePath: string | null = null

    try {
      const inputStats = await fs.promises.stat(inputPath).catch(() => null)
      if (!inputStats?.isFile()) {
        throw new Error(`Input audio file does not exist: ${inputPath}`)
      }

      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })

      const modelPath = await this.getResourcePath(MODEL_NAME)
      const forcedAlignerPath =
        returnTimestamps && useForcedAligner
          ? await this.getResourcePath(FORCED_ALIGNER_MODEL_NAME)
          : undefined
      const nvidiaLibsPath = cudaRuntimePath ?? NVIDIA_LIBS_PATH
      const torchLibsPath = torchPath ?? PYTORCH_TORCH_PATH

      const tasks: Qwen3ASRTask[] = [
        {
          audio_path: inputPath,
          output_path: outputPath
        }
      ]

      tempDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), 'qwen3_asr_tasks_')
      )
      jsonFilePath = path.join(tempDir, 'tasks.json')

      await fs.promises.writeFile(
        jsonFilePath,
        JSON.stringify(tasks, null, 2),
        'utf8'
      )

      const args = [
        '--function',
        'transcribe_audio',
        '--json_file',
        jsonFilePath,
        '--model_path',
        modelPath,
        '--device',
        device,
        '--batch_size',
        batchSize.toString(),
        '--language',
        language,
        '--return_timestamps',
        returnTimestamps ? 'true' : 'false',
        '--chunk_duration',
        chunkDuration.toString()
      ]

      if (nvidiaLibsPath) {
        args.push('--cuda_runtime_path', nvidiaLibsPath)
      }

      if (torchLibsPath) {
        args.push('--torch_path', torchLibsPath)
      }

      if (forcedAlignerPath) {
        args.push('--forced_aligner_model_path', forcedAlignerPath)
      }

      if (cpuBatchSize) {
        args.push('--cpu_batch_size', cpuBatchSize.toString())
      }

      await this.executeCommand({
        binaryName: 'qwen3_asr',
        args,
        options: { sync: true }
      })

      const transcriptionContent = await fs.promises.readFile(
        outputPath,
        'utf-8'
      )
      const parsedOutput = this.parseTranscription(transcriptionContent)

      await fs.promises.writeFile(
        outputPath,
        JSON.stringify(parsedOutput, null, 2),
        'utf8'
      )

      return outputPath
    } catch (error: unknown) {
      throw new Error(`Audio transcription failed: ${(error as Error).message}`)
    }
  }

  private parseTranscription(
    rawOutput: Qwen3ASRTranscriptionOutput
  ): TranscriptionOutput {
    const lines = rawOutput
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    const segments: TranscriptionOutput['segments'] = []
    const segmentRegex = /^\[(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)s\]\s+(.+)$/
    let duration = 0

    for (const line of lines) {
      const match = line.match(segmentRegex)
      if (match && match[1] && match[2] && match[3]) {
        const start = parseFloat(match[1])
        const end = parseFloat(match[2])

        segments.push({
          from: start,
          to: end,
          text: match[3].trim(),
          speaker: null
        })

        if (end > duration) {
          duration = end
        }
      }
    }

    if (segments.length === 0 && lines.length > 0) {
      segments.push({
        from: 0,
        to: 0,
        text: lines[0] ?? '',
        speaker: null
      })
    }

    return {
      duration,
      speakers: [],
      speaker_count: 0,
      segments,
      metadata: {
        tool: this.toolName
      }
    }
  }
}

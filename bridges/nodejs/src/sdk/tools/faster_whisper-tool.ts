import fs from 'node:fs'

import type { TranscriptionOutput } from '@sdk/tools/schemas'
import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

/**
 * Example:
 *
 * Detected language: en (probability: 1.00)
 * Duration: 26.84 seconds
 * ==================================================
 *
 * [0.00 -> 5.70] DuckDB, an open-source, fast, embeddable, SQL OLAP database that simplifies the way
 * [5.70 -> 10.84] developers implement analytics. It was developed in the Netherlands, written in C++, and first
 * [10.84 -> 16.78] released in 2019. And the TLDR is that it's like SQLite, but for columnar data. Everybody knows
 */
type FasterWhisperTranscriptionOutput = string

const MODEL_NAME = 'faster-whisper-large-v3'

export default class FasterWhisperTool extends Tool {
  private static readonly TOOLKIT = 'music_audio'
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    // Load configuration from central toolkits directory
    this.config = ToolkitConfig.load(FasterWhisperTool.TOOLKIT, this.toolName)
  }

  get toolName(): string {
    // Use the actual config name for toolkit lookup
    return 'faster_whisper'
  }

  get toolkit(): string {
    return FasterWhisperTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Transcribe audio to a file using faster-whisper
   * @param inputPath The file path of the audio to be transcribed
   * @param outputPath The desired file path for the transcription output
   * @param device Device to use for processing (cpu, cuda, auto)
   * @param cpuThreads Number of CPU threads to use
   * @param downloadRoot Root directory for model downloads
   * @param localFilesOnly Whether to use only local files
   * @returns A promise that resolves with the path to the transcription file
   */
  async transcribeToFile(
    inputPath: string,
    outputPath: string,
    device = 'auto',
    cpuThreads?: number,
    downloadRoot?: string,
    localFilesOnly = false
  ): Promise<string> {
    try {
      // Get model path using the generic resource system
      const modelPath = await this.getResourcePath(MODEL_NAME)

      const args = [
        '--function',
        'transcribe_to_file',
        '--input',
        inputPath,
        '--output',
        outputPath,
        '--model_size_or_path',
        modelPath,
        '--device',
        device
      ]

      if (cpuThreads) {
        args.push('--cpu_threads', cpuThreads.toString())
      }

      if (downloadRoot) {
        args.push('--download_root', downloadRoot)
      }

      if (localFilesOnly) {
        args.push('--local_files_only')
      }

      await this.executeCommand({
        binaryName: 'faster_whisper',
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

  /**
   * Speaker diarization is not supported for Faster Whisper
   */
  private parseTranscription(
    rawOutput: FasterWhisperTranscriptionOutput
  ): TranscriptionOutput {
    const lines = rawOutput.split('\n')

    const durationLine = lines.find((line) => line.startsWith('Duration:'))
    let duration = 0

    if (durationLine) {
      const match = durationLine.match(/Duration:\s+([\d.]+)\s+seconds/)

      if (match && match[1]) {
        duration = parseFloat(match[1])
      }
    }

    const segments: TranscriptionOutput['segments'] = []
    const segmentRegex = /^\[(\d+\.\d+)\s+->\s+(\d+\.\d+)\]\s+(.+)$/

    for (const line of lines) {
      const match = line.match(segmentRegex)
      if (match && match[1] && match[2] && match[3]) {
        const start = match[1]
        const end = match[2]
        const text = match[3]

        segments.push({
          from: parseFloat(start),
          to: parseFloat(end),
          text: text.trim(),
          speaker: null
        })
      }
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

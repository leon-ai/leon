import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

export default class FfmpegTool extends Tool {
  private static readonly TOOLKIT = 'video_streaming'
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    // Load configuration from central toolkits directory
    // Use class name for tool config name
    const toolConfigName = this.constructor.name
      .toLowerCase()
      .replace('tool', '')
    this.config = ToolkitConfig.load(FfmpegTool.TOOLKIT, toolConfigName)
  }

  get toolName(): string {
    // Dynamic tool name based on class name
    return this.constructor.name
  }

  get toolkit(): string {
    return FfmpegTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Get global FFmpeg arguments to hide banner and set log level to error
   */
  private getGlobalArgs(): string[] {
    return ['-hide_banner', '-loglevel', 'error']
  }

  /**
   * Converts a video file to a different format.
   * @param inputPath The file path of the video to be converted.
   * @param outputPath The desired file path for the converted video.
   * @returns A promise that resolves with the path to the converted video file.
   */
  async convertVideoFormat(
    inputPath: string,
    outputPath: string
  ): Promise<string> {
    try {
      await this.executeCommand({
        binaryName: 'ffmpeg',
        args: [...this.getGlobalArgs(), '-i', inputPath, outputPath],
        options: { sync: true }
      })

      return outputPath
    } catch (error: unknown) {
      throw new Error(`Video conversion failed: ${(error as Error).message}`)
    }
  }

  /**
   * Extracts the audio track from a video file and saves it as a separate audio file.
   * @param videoPath The file path of the video from which to extract audio.
   * @param audioPath The desired file path for the extracted audio.
   * @returns A promise that resolves with the path to the extracted audio file.
   */
  async extractAudio(videoPath: string, audioPath: string): Promise<string> {
    try {
      // Keep it simple: do not force codec/bitrate. Let ffmpeg choose defaults based on extension.
      // Add -progress to emit periodic key=value lines we can log as progress.
      const args = [
        ...this.getGlobalArgs(),
        '-y',
        '-i',
        videoPath,
        '-vn',
        // Progress to stderr so we can parse without interfering with stdout JSON
        '-progress',
        'pipe:2',
        audioPath
      ]

      await this.executeCommand({
        binaryName: 'ffmpeg',
        args,
        options: { sync: false },
        onOutput: (data: string, isError?: boolean) => {
          // Parse ffmpeg -progress key=value lines from stderr
          if (!isError) return
          const lines = data.split('\n')
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.includes('=')) continue
            const [key, value] = trimmed.split('=')
            if (!key || value === undefined) continue

            // Log some useful progress keys
            if (key === 'progress') {
              this.log(`ffmpeg progress: ${value}`)
            } else if (key === 'out_time_ms') {
              const ms = parseInt(value, 10)
              if (!Number.isNaN(ms)) {
                const seconds = Math.floor(ms / 1_000_000)
                this.log(`processed_time_seconds=${seconds}`)
              }
            } else if (key === 'speed') {
              this.log(`speed=${value}`)
            }
          }
        }
      })

      return audioPath
    } catch (error: unknown) {
      throw new Error(`Audio extraction failed: ${(error as Error).message}`)
    }
  }

  /**
   * Trims a media (video or audio) file to a specified duration.
   * @param inputPath The file path of the media to be trimmed.
   * @param outputPath The desired file path for the trimmed media.
   * @param startTime The start time for the trim, formatted as HH:MM:SS.
   * @param endTime The end time for the trim, formatted as HH:MM:SS.
   * @returns A promise that resolves with the path to the trimmed media file.
   */
  async trimMedia(
    inputPath: string,
    outputPath: string,
    startTime: string,
    endTime: string
  ): Promise<string> {
    try {
      await this.executeCommand({
        binaryName: 'ffmpeg',
        args: [
          ...this.getGlobalArgs(),
          '-i',
          inputPath,
          '-ss',
          startTime,
          '-to',
          endTime,
          '-c',
          'copy',
          outputPath
        ],
        options: { sync: true }
      })

      return outputPath
    } catch (error: unknown) {
      throw new Error(`Video trimming failed: ${(error as Error).message}`)
    }
  }

  /**
   * Resizes a video to the specified dimensions.
   * @param inputPath The file path of the video to be resized.
   * @param outputPath The desired file path for the resized video.
   * @param width The target width of the video in pixels.
   * @param height The target height of the video in pixels.
   * @returns A promise that resolves with the path to the resized video file.
   */
  async resizeVideo(
    inputPath: string,
    outputPath: string,
    width: number,
    height: number
  ): Promise<string> {
    try {
      await this.executeCommand({
        binaryName: 'ffmpeg',
        args: [
          ...this.getGlobalArgs(),
          '-i',
          inputPath,
          '-vf',
          `scale=${width}:${height}`,
          outputPath
        ],
        options: { sync: true }
      })

      return outputPath
    } catch (error: unknown) {
      throw new Error(`Video resizing failed: ${(error as Error).message}`)
    }
  }

  /**
   * Merges a video file with a separate audio file.
   * @param videoPath The file path of the video file.
   * @param audioPath The file path of the audio file.
   * @param outputPath The desired file path for the combined video and audio.
   * @returns A promise that resolves with the path to the merged video file.
   */
  async combineVideoAndAudio(
    videoPath: string,
    audioPath: string,
    outputPath: string
  ): Promise<string> {
    try {
      await this.executeCommand({
        binaryName: 'ffmpeg',
        args: [
          ...this.getGlobalArgs(),
          '-i',
          videoPath,
          '-i',
          audioPath,
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-strict',
          'experimental',
          outputPath
        ],
        options: { sync: true }
      })

      return outputPath
    } catch (error: unknown) {
      throw new Error(
        `Video and audio combination failed: ${(error as Error).message}`
      )
    }
  }

  /**
   * Replaces the audio track of a video with a new audio file.
   * Removes/mutes the original audio and merges the new audio with the video.
   * @param videoPath The file path of the video file.
   * @param newAudioPath The file path of the new audio file to replace the original audio.
   * @param outputPath The desired file path for the video with replaced audio.
   * @returns A promise that resolves with the path to the video file with new audio.
   */
  async replaceVideoAudio(
    videoPath: string,
    newAudioPath: string,
    outputPath: string
  ): Promise<string> {
    try {
      // Use -map to explicitly map video from first input and audio from second input
      // This effectively removes the original audio and replaces it with the new audio
      await this.executeCommand({
        binaryName: 'ffmpeg',
        args: [
          ...this.getGlobalArgs(),
          '-y', // Overwrite output file if it exists
          '-i',
          videoPath,
          '-i',
          newAudioPath,
          '-map',
          '0:v:0', // Map video from first input
          '-map',
          '1:a:0', // Map audio from second input
          '-c:v',
          'copy', // Copy video codec (no re-encoding)
          '-c:a',
          'aac', // Encode audio to AAC
          '-b:a',
          '192k', // Audio bitrate
          '-shortest', // Finish encoding when the shortest input stream ends
          outputPath
        ],
        options: { sync: true }
      })

      return outputPath
    } catch (error: unknown) {
      throw new Error(
        `Video audio replacement failed: ${(error as Error).message}`
      )
    }
  }

  /**
   * Compresses a video to reduce its file size.
   * @param inputPath The file path of the video to be compressed.
   * @param outputPath The desired file path for the compressed video.
   * @param bitrate The target bitrate for the video (e.g., "1000k").
   * @returns A promise that resolves with the path to the compressed video file.
   */
  async compressVideo(
    inputPath: string,
    outputPath: string,
    bitrate: string
  ): Promise<string> {
    try {
      await this.executeCommand({
        binaryName: 'ffmpeg',
        args: [
          ...this.getGlobalArgs(),
          '-i',
          inputPath,
          '-b:v',
          bitrate,
          outputPath
        ],
        options: { sync: true }
      })

      return outputPath
    } catch (error: unknown) {
      throw new Error(`Video compression failed: ${(error as Error).message}`)
    }
  }

  /**
   * Adjusts the tempo (speed) of an audio file using the atempo filter.
   * If the speed factor is greater than 2.0, multiple atempo filters are chained.
   * @param inputPath The file path of the audio to be speed-adjusted.
   * @param outputPath The desired file path for the speed-adjusted audio.
   * @param speedFactor The speed multiplier (e.g., 1.3 for 30% faster, 0.8 for 20% slower). Must be between 0.5 and 100.0.
   * @param sampleRate Optional sample rate for the output audio (defaults to the input's sample rate).
   * @returns A promise that resolves with the path to the speed-adjusted audio file.
   */
  async adjustTempo(
    inputPath: string,
    outputPath: string,
    speedFactor: number,
    sampleRate?: number
  ): Promise<string> {
    try {
      if (speedFactor < 0.5 || speedFactor > 100.0) {
        throw new Error('Speed factor must be between 0.5 and 100.0')
      }

      // FFmpeg's atempo filter only supports values between 0.5 and 2.0
      // For larger speed factors, we need to chain multiple atempo filters
      const atempoFilters: string[] = []
      let remainingSpeed = speedFactor

      while (remainingSpeed > 2.0) {
        atempoFilters.push('atempo=2.0')
        remainingSpeed /= 2.0
      }

      if (remainingSpeed < 1.0 && remainingSpeed < 0.5) {
        while (remainingSpeed < 0.5) {
          atempoFilters.push('atempo=0.5')
          remainingSpeed /= 0.5
        }
      }

      atempoFilters.push(`atempo=${remainingSpeed.toFixed(6)}`)

      const filterComplex = atempoFilters.join(',')
      const args = [
        ...this.getGlobalArgs(),
        '-y',
        '-i',
        inputPath,
        '-filter:a',
        filterComplex
      ]

      if (sampleRate) {
        args.push('-ar', sampleRate.toString())
      }

      args.push(outputPath)

      await this.executeCommand({
        binaryName: 'ffmpeg',
        args,
        options: { sync: true }
      })

      return outputPath
    } catch (error: unknown) {
      throw new Error(
        `Audio tempo adjustment failed: ${(error as Error).message}`
      )
    }
  }

  /**
   * Get the duration of an audio/video file in milliseconds using ffprobe.
   * @param filePath The path to the audio or video file
   * @returns A promise that resolves with the duration in milliseconds
   */
  async getAudioDuration(filePath: string): Promise<number> {
    try {
      const result = await this.executeCommand({
        binaryName: 'ffprobe',
        args: ['-hide_banner', '-v', 'error', '-show_format', filePath],
        options: { sync: true }
      })

      // Parse the duration from stdout (format: duration=123.456)
      const lines = result.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.startsWith('duration=')) {
          const durationSeconds = parseFloat(trimmed.split('=')[1] || '')
          if (!isNaN(durationSeconds)) {
            return Math.round(durationSeconds * 1_000)
          }
        }
      }
      throw new Error('Could not parse duration from ffprobe output')
    } catch (error: unknown) {
      throw new Error(
        `Failed to get audio duration: ${(error as Error).message}`
      )
    }
  }

  /**
   * Merges two audio files into one.
   * @param firstAudioPath The path to the first audio file.
   * @param secondAudioPath The path to the second audio file.
   * @param outputPath The desired file path for the merged audio.
   * @returns A promise that resolves with the path to the merged audio file.
   */
  async mergeAudio(
    firstAudioPath: string,
    secondAudioPath: string,
    outputPath: string
  ): Promise<string> {
    try {
      await this.executeCommand({
        binaryName: 'ffmpeg',
        args: [
          ...this.getGlobalArgs(),
          '-y',
          '-i',
          firstAudioPath,
          '-i',
          secondAudioPath,
          '-filter_complex',
          'amix=inputs=2:duration=longest:dropout_transition=0',
          outputPath
        ],
        options: { sync: true }
      })

      return outputPath
    } catch (error: unknown) {
      throw new Error(`Audio merging failed: ${(error as Error).message}`)
    }
  }

  /**
   * Assembles multiple audio segments into a single audio file with precise timing.
   * Each segment is placed at its exact timestamp with silence padding where needed.
   * Similar to pydub's overlay functionality but using FFmpeg.
   * @param segments Array of {path: string, startMs: number} objects representing audio segments and their start times in milliseconds
   * @param outputPath The desired file path for the assembled audio
   * @param totalDurationMs The total duration of the output audio in milliseconds
   * @param sampleRate Optional sample rate for the output audio (default: 22050)
   * @returns A promise that resolves with the path to the assembled audio file
   */
  async assembleAudioSegments(
    segments: Array<{ path: string; startMs: number }>,
    outputPath: string,
    totalDurationMs: number,
    sampleRate: number = 22_050
  ): Promise<string> {
    try {
      if (segments.length === 0) {
        throw new Error('No segments provided for assembly')
      }

      // Build FFmpeg filter_complex for assembling segments at precise timestamps
      // We'll use the adelay filter to position each segment at its start time
      const inputs: string[] = []
      const filterParts: string[] = []

      // Add all segment files as inputs
      for (const segment of segments) {
        inputs.push('-i', segment.path)
      }

      // Build filter chain: adelay each segment, then amix them all together
      for (let i = 0; i < segments.length; i += 1) {
        const delayMs = segments[i]?.startMs ?? 0
        // adelay takes delay in milliseconds
        filterParts.push(`[${i}:a]adelay=${delayMs}|${delayMs}[a${i}]`)
      }

      // Mix all delayed streams together with normalization
      // Use amix with normalize=0 and weights=1 to prevent volume reduction
      const mixInputs = segments.map((_, i) => `[a${i}]`).join('')
      filterParts.push(
        `${mixInputs}amix=inputs=${segments.length}:duration=longest:dropout_transition=0:normalize=0[mixed]`
      )

      // Apply dynamic normalization and compression to maintain consistent volume
      filterParts.push(`[mixed]dynaudnorm=f=150:g=15:p=0.9:s=5[normalized]`)

      // Apply a slight compression to even out volume levels
      filterParts.push(
        `[normalized]acompressor=threshold=0.089:ratio=4:attack=20:release=250[aout]`
      )

      const filterComplex = filterParts.join(';')

      // Calculate total duration in seconds for ffmpeg
      const totalDurationS = totalDurationMs / 1000

      const args = [
        ...this.getGlobalArgs(),
        '-y',
        ...inputs,
        '-filter_complex',
        filterComplex,
        '-map',
        '[aout]',
        '-ar',
        sampleRate.toString(),
        '-t',
        totalDurationS.toFixed(3),
        '-c:a',
        'pcm_s16le',
        outputPath
      ]

      await this.executeCommand({
        binaryName: 'ffmpeg',
        args,
        options: { sync: true }
      })

      return outputPath
    } catch (error: unknown) {
      throw new Error(`Audio assembly failed: ${(error as Error).message}`)
    }
  }
}

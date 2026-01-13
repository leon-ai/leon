import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { Tool, type ProgressCallback } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

export default class YtdlpTool extends Tool {
  private static readonly TOOLKIT = 'video_streaming'
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    // Load configuration from central toolkits directory
    // Use class name for tool config name
    const toolConfigName = this.constructor.name
      .toLowerCase()
      .replace('tool', '')
    this.config = ToolkitConfig.load(YtdlpTool.TOOLKIT, toolConfigName)
  }

  get toolName(): string {
    // Dynamic tool name based on class name
    return this.constructor.name
  }

  get toolkit(): string {
    return YtdlpTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Build common yt-dlp arguments with retry and sleep options
   */
  private buildCommonArgs(): string[] {
    return [
      '--retries',
      '3',
      '--sleep-interval',
      '0.5',
      '--max-sleep-interval',
      '2'
    ]
  }

  /**
   * Downloads a single video from the provided URL.
   * @param videoUrl The URL of the video to download.
   * @param outputPath The directory where the video will be saved.
   * @returns A promise that resolves with the file path of the downloaded video.
   */
  async downloadVideo(videoUrl: string, outputPath: string): Promise<string> {
    try {
      // Ensure output directory exists
      mkdirSync(outputPath, { recursive: true })

      // Run yt-dlp with output template
      const outputTemplate = join(outputPath, '%(title)s.%(ext)s')
      const result = await this.executeCommand({
        binaryName: 'yt-dlp',
        args: [...this.buildCommonArgs(), videoUrl, '-o', outputTemplate],
        options: { sync: true }
      })

      // Parse the output to get the actual filename
      const lines = result.split('\n')
      for (const line of lines) {
        if (
          line.includes('has already been downloaded') ||
          line.includes('Destination:')
        ) {
          const filename = line.split(' ').pop()
          if (filename) return filename
        }
      }

      // If we can't parse the exact filename, return the template path
      return outputTemplate
    } catch (error: unknown) {
      throw new Error(`Video download failed: ${(error as Error).message}`)
    }
  }

  /**
   * Downloads the audio track from a video and saves it as an audio file.
   * @param videoUrl The URL of the video.
   * @param outputPath The directory to save the audio file in.
   * @param audioFormat The desired audio format (e.g., 'mp3', 'm4a', 'wav').
   * @returns A promise that resolves with the file path of the extracted audio.
   */
  async downloadAudioOnly(
    videoUrl: string,
    outputPath: string,
    audioFormat: string
  ): Promise<string> {
    try {
      // Ensure output directory exists
      mkdirSync(outputPath, { recursive: true })

      // Run yt-dlp with audio extraction
      const outputTemplate = join(outputPath, `%(title)s.${audioFormat}`)
      const result = await this.executeCommand({
        binaryName: 'yt-dlp',
        args: [
          ...this.buildCommonArgs(),
          videoUrl,
          '-x',
          '--audio-format',
          audioFormat,
          '-o',
          outputTemplate
        ],
        options: { sync: true }
      })

      // Parse the output to get the actual filename
      const lines = result.split('\n')
      for (const line of lines) {
        if (
          line.includes('has already been downloaded') ||
          line.includes('Destination:')
        ) {
          const filename = line.split(' ').pop()
          if (filename) return filename
        }
      }

      return outputTemplate
    } catch (error: unknown) {
      throw new Error(`Audio download failed: ${(error as Error).message}`)
    }
  }

  /**
   * Downloads all videos from a given playlist URL.
   * @param playlistUrl The URL of the playlist.
   * @param outputPath The directory where the playlist videos will be saved.
   * @returns A promise that resolves with the path to the directory containing the downloaded videos.
   */
  async downloadPlaylist(
    playlistUrl: string,
    outputPath: string
  ): Promise<string> {
    try {
      // Ensure output directory exists
      mkdirSync(outputPath, { recursive: true })

      // Run yt-dlp for playlist
      const outputTemplate = join(
        outputPath,
        '%(playlist_index)s - %(title)s.%(ext)s'
      )
      await this.executeCommand({
        binaryName: 'yt-dlp',
        args: [...this.buildCommonArgs(), playlistUrl, '-o', outputTemplate],
        options: { sync: true }
      })

      return outputPath
    } catch (error: unknown) {
      throw new Error(`Playlist download failed: ${(error as Error).message}`)
    }
  }

  /**
   * Downloads a video in a specific quality or resolution.
   * @param videoUrl The URL of the video to download.
   * @param outputPath The directory where the video will be saved.
   * @param quality The desired quality string (e.g., 'best', '720p', '1080p').
   * @param onProgress The callback function for progress reporting.
   * @returns A promise that resolves with the file path of the downloaded video.
   */
  async downloadVideoByQuality(
    videoUrl: string,
    outputPath: string,
    quality: string,
    onProgress?: ProgressCallback
  ): Promise<string> {
    try {
      // Ensure output directory exists
      mkdirSync(outputPath, { recursive: true })

      // Convert quality to yt-dlp format
      let formatSelector: string
      if (quality === 'best') {
        formatSelector = 'best'
      } else if (quality === 'worst') {
        formatSelector = 'worst'
      } else if (quality.endsWith('p')) {
        // For resolution like 720p, 1080p
        const height = quality.slice(0, -1)
        formatSelector = `best[height<=${height}]`
      } else {
        formatSelector = quality
      }

      const outputTemplate = join(outputPath, '%(title)s.%(ext)s')
      let downloadedFilePath = outputTemplate

      await this.executeCommand({
        binaryName: 'yt-dlp',
        args: [
          ...this.buildCommonArgs(),
          videoUrl,
          '-f',
          formatSelector,
          '-o',
          outputTemplate,
          '--newline'
        ],
        options: { sync: false },
        onProgress,
        onOutput: (output, isError) => {
          if (!isError) {
            const lines = output.split('\n')

            for (const line of lines) {
              // Parse download progress
              if (line.includes('[download]')) {
                const progressMatch = line.match(
                  /\[download\]\s+(\d+\.?\d*)%\s+of\s+(?:~?\s*)([\d.]+\w+)\s+at\s+([\d.]+\w+\/s)\s+ETA\s+([\d:]+)/
                )
                if (
                  progressMatch &&
                  progressMatch[1] &&
                  progressMatch[2] &&
                  progressMatch[3] &&
                  progressMatch[4] &&
                  onProgress
                ) {
                  onProgress({
                    percentage: parseFloat(progressMatch[1]),
                    size: progressMatch[2],
                    speed: progressMatch[3],
                    eta: progressMatch[4],
                    status: 'downloading'
                  })
                }
              }

              // Check for completed download or destination file
              if (
                line.includes('[download] Destination:') ||
                line.includes('has already been downloaded')
              ) {
                const pathMatch =
                  line.match(/Destination:\s+(.+)$/) ||
                  line.match(/(.+)\s+has already been downloaded/)
                if (pathMatch && pathMatch[1]) {
                  downloadedFilePath = pathMatch[1].trim()
                }
              }

              // Check for download completion
              if (line.includes('[download] 100%') && onProgress) {
                onProgress({
                  percentage: 100,
                  status: 'completed'
                })
              }
            }
          }
        }
      })

      return downloadedFilePath
    } catch (error: unknown) {
      throw new Error(
        `Quality-specific video download failed: ${(error as Error).message}`
      )
    }
  }

  /**
   * Downloads the subtitles for a video.
   * @param videoUrl The URL of the video.
   * @param outputPath The directory to save the subtitle file in.
   * @param languageCode The language code for the desired subtitles (e.g., 'en', 'es').
   * @returns A promise that resolves with the file path of the downloaded subtitle file.
   */
  async downloadSubtitles(
    videoUrl: string,
    outputPath: string,
    languageCode: string
  ): Promise<string> {
    try {
      // Ensure output directory exists
      mkdirSync(outputPath, { recursive: true })

      // Download subtitles only
      const outputTemplate = join(outputPath, '%(title)s.%(ext)s')
      await this.executeCommand({
        binaryName: 'yt-dlp',
        args: [
          ...this.buildCommonArgs(),
          videoUrl,
          '--write-subs',
          '--sub-langs',
          languageCode,
          '--skip-download',
          '-o',
          outputTemplate
        ],
        options: { sync: true }
      })

      // The subtitle file will have the same name but with .srt extension
      const subtitleFile = outputTemplate.replace(
        '.%(ext)s',
        `.${languageCode}.srt`
      )
      return subtitleFile
    } catch (error: unknown) {
      throw new Error(`Subtitle download failed: ${(error as Error).message}`)
    }
  }

  /**
   * Downloads a video and embeds its thumbnail as cover art.
   * @param videoUrl The URL of the video.
   * @param outputPath The directory where the video will be saved.
   * @returns A promise that resolves with the file path of the video with the embedded thumbnail.
   */
  async downloadVideoWithThumbnail(
    videoUrl: string,
    outputPath: string
  ): Promise<string> {
    try {
      // Ensure output directory exists
      mkdirSync(outputPath, { recursive: true })

      // Download with thumbnail embedding
      const outputTemplate = join(outputPath, '%(title)s.%(ext)s')
      const result = await this.executeCommand({
        binaryName: 'yt-dlp',
        args: [
          ...this.buildCommonArgs(),
          videoUrl,
          '--embed-thumbnail',
          '--write-thumbnail',
          '-o',
          outputTemplate
        ],
        options: { sync: true }
      })

      // Parse the output to get the actual filename
      const lines = result.split('\n')
      for (const line of lines) {
        if (
          line.includes('has already been downloaded') ||
          line.includes('Destination:')
        ) {
          const filename = line.split(' ').pop()
          if (filename) return filename
        }
      }

      return outputTemplate
    } catch (error: unknown) {
      throw new Error(
        `Video with thumbnail download failed: ${(error as Error).message}`
      )
    }
  }
}

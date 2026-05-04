import { existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'

import { Tool, type ProgressCallback } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const DEFAULT_SETTINGS: Record<string, unknown> = {}
const REQUIRED_SETTINGS: string[] = []
const DOWNLOAD_DESTINATION_PATTERN = /Destination:\s+(.+)$/
const ALREADY_DOWNLOADED_PATTERN =
  /\[download\]\s+(.+)\s+has already been downloaded/
const SUBTITLE_DESTINATION_PATTERN =
  /Writing (?:video subtitles|video automatic captions) to:\s+(.+)$/
const DOWNLOAD_PROGRESS_PATTERN =
  /\[download\]\s+(\d+\.?\d*)%\s+of\s+(?:~?\s*)([\d.]+\w+)\s+at\s+([\d.]+\w+\/s)\s+ETA\s+([\d:]+)/
const YTDLP_EXT_TEMPLATE = '%(ext)s'
const YTDLP_TITLE_TEMPLATE = '%(title)s'
const YTDLP_PLAYLIST_INDEX_TEMPLATE = '%(playlist_index)s'
const SUBTITLE_FORMAT = 'srt/best'
const SUBTITLE_CONVERT_FORMAT = 'srt'
const LANGUAGE_CODE_SEPARATOR = ','
const SUBTITLE_OUTPUT_TYPE = 'subtitle'
const TYPED_OUTPUT_SEPARATOR = ':'

interface OutputTarget {
  directoryPath: string
  outputTemplate: string
  predictedFilePath?: string
}

export default class YtdlpTool extends Tool {
  private static readonly TOOLKIT = 'video_streaming'
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    // Load configuration from central toolkits directory
    // Use class name for tool config name
    this.config = ToolkitConfig.load(YtdlpTool.TOOLKIT, this.toolName)
    const toolSettings = ToolkitConfig.loadToolSettings(
      YtdlpTool.TOOLKIT,
      this.toolName,
      DEFAULT_SETTINGS
    )
    this.settings = toolSettings
    this.requiredSettings = REQUIRED_SETTINGS
    this.checkRequiredSettings(this.toolName)
  }

  get toolName(): string {
    return 'ytdlp'
  }

  get toolkit(): string {
    return YtdlpTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  private getConfigArgs(): string[] {
    const configPath = join(this.getToolDir(import.meta.url), 'yt-dlp.conf')
    return ['--config-locations', configPath]
  }

  /**
   * Resolves media output using yt-dlp filename templates.
   */
  private static resolveMediaOutputTarget(
    outputPath: string,
    expectedExtension?: string
  ): OutputTarget {
    const extension = extname(outputPath)
    const looksLikeFile = extension !== ''
    const existingFileLikeDirectory =
      looksLikeFile && existsSync(outputPath) && statSync(outputPath).isDirectory()

    if (!looksLikeFile) {
      return {
        directoryPath: outputPath,
        outputTemplate: join(
          outputPath,
          `${YTDLP_TITLE_TEMPLATE}.${YTDLP_EXT_TEMPLATE}`
        )
      }
    }

    const stem = basename(outputPath, extension)
    const directoryPath = existingFileLikeDirectory ? outputPath : dirname(outputPath)
    const outputTemplate = join(directoryPath, `${stem}.${YTDLP_EXT_TEMPLATE}`)
    const predictedFilePath = expectedExtension
      ? join(directoryPath, `${stem}.${expectedExtension}`)
      : undefined

    return { directoryPath, outputTemplate, predictedFilePath }
  }

  /**
   * Resolves subtitle output using yt-dlp's typed output template.
   */
  private static resolveSubtitleOutputTarget(
    outputPath: string,
    languageCode: string
  ): OutputTarget {
    const extension = extname(outputPath)
    const looksLikeFile = extension !== ''
    const primaryLanguageCode = this.getPrimaryLanguageCode(languageCode)
    const existingFileLikeDirectory =
      looksLikeFile && existsSync(outputPath) && statSync(outputPath).isDirectory()

    if (!looksLikeFile) {
      return {
        directoryPath: outputPath,
        outputTemplate: join(
          outputPath,
          `${YTDLP_TITLE_TEMPLATE}.${YTDLP_EXT_TEMPLATE}`
        )
      }
    }

    const requestedStem = basename(outputPath, extension)
    const stem = this.stripSubtitleLanguageSuffix(
      requestedStem,
      primaryLanguageCode
    )
    const directoryPath = existingFileLikeDirectory ? outputPath : dirname(outputPath)

    return {
      directoryPath,
      outputTemplate: join(directoryPath, `${stem}.${YTDLP_EXT_TEMPLATE}`),
      predictedFilePath: join(
        directoryPath,
        `${stem}.${primaryLanguageCode}.${SUBTITLE_CONVERT_FORMAT}`
      )
    }
  }

  /**
   * Returns the first language code when yt-dlp receives a language list.
   */
  private static getPrimaryLanguageCode(languageCode: string): string {
    return languageCode.split(LANGUAGE_CODE_SEPARATOR)[0]?.trim() || languageCode
  }

  /**
   * Removes a trailing subtitle language suffix from a requested file stem.
   */
  private static stripSubtitleLanguageSuffix(
    stem: string,
    languageCode: string
  ): string {
    const suffix = `.${languageCode}`
    return stem.endsWith(suffix) ? stem.slice(0, -suffix.length) : stem
  }

  /**
   * Builds a typed yt-dlp output template, e.g. "subtitle:path.%(ext)s".
   */
  private static buildTypedOutputTemplate(type: string, template: string): string {
    return `${type}${TYPED_OUTPUT_SEPARATOR}${template}`
  }

  /**
   * Parses file paths reported by yt-dlp.
   */
  private static parseOutputFilePath(output: string): string | null {
    for (const line of output.split('\n')) {
      const match =
        line.match(DOWNLOAD_DESTINATION_PATTERN) ||
        line.match(ALREADY_DOWNLOADED_PATTERN) ||
        line.match(SUBTITLE_DESTINATION_PATTERN)

      if (match?.[1]) {
        return match[1].trim()
      }
    }

    return null
  }

  /**
   * Resolves a media path from yt-dlp output or a deterministic file target.
   */
  private static resolveDownloadedMediaPath(
    output: string,
    target: OutputTarget
  ): string {
    if (target.predictedFilePath && existsSync(target.predictedFilePath)) {
      return target.predictedFilePath
    }

    const parsedPath = this.parseOutputFilePath(output)

    if (parsedPath) {
      return parsedPath
    }

    throw new Error('yt-dlp completed but no output file path could be resolved')
  }

  /**
   * Resolves a subtitle path and ensures a subtitle file was created.
   */
  private static resolveDownloadedSubtitlePath(
    output: string,
    target: OutputTarget
  ): string {
    const parsedPath = this.parseOutputFilePath(output)

    for (const candidate of [target.predictedFilePath, parsedPath]) {
      if (candidate && existsSync(candidate) && statSync(candidate).isFile()) {
        return candidate
      }
    }

    throw new Error('yt-dlp completed but no subtitle file was created')
  }

  /**
   * Downloads a single video from the provided URL.
   * @param videoUrl The URL of the video to download.
   * @param outputPath The directory where the video will be saved.
   * @returns A promise that resolves with the file path of the downloaded video.
   */
  async downloadVideo(videoUrl: string, outputPath: string): Promise<string> {
    try {
      const target = YtdlpTool.resolveMediaOutputTarget(outputPath)
      mkdirSync(target.directoryPath, { recursive: true })

      const result = await this.executeCommand({
        binaryName: 'yt-dlp',
        args: [...this.getConfigArgs(), videoUrl, '-o', target.outputTemplate],
        options: { sync: true }
      })

      return YtdlpTool.resolveDownloadedMediaPath(result, target)
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
      const target = YtdlpTool.resolveMediaOutputTarget(outputPath, audioFormat)
      mkdirSync(target.directoryPath, { recursive: true })

      const result = await this.executeCommand({
        binaryName: 'yt-dlp',
        args: [
          ...this.getConfigArgs(),
          videoUrl,
          '-x',
          '--audio-format',
          audioFormat,
          '-o',
          target.outputTemplate
        ],
        options: { sync: true }
      })

      return YtdlpTool.resolveDownloadedMediaPath(result, target)
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
        `${YTDLP_PLAYLIST_INDEX_TEMPLATE} - ${YTDLP_TITLE_TEMPLATE}.${YTDLP_EXT_TEMPLATE}`
      )
      await this.executeCommand({
        binaryName: 'yt-dlp',
        args: [...this.getConfigArgs(), playlistUrl, '-o', outputTemplate],
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

      const target = YtdlpTool.resolveMediaOutputTarget(outputPath)
      mkdirSync(target.directoryPath, { recursive: true })
      let downloadedFilePath = ''

      await this.executeCommand({
        binaryName: 'yt-dlp',
        args: [
          ...this.getConfigArgs(),
          videoUrl,
          '-f',
          formatSelector,
          '-o',
          target.outputTemplate,
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
                const progressMatch = line.match(DOWNLOAD_PROGRESS_PATTERN)
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

              const pathMatch = YtdlpTool.parseOutputFilePath(line)
              if (pathMatch) {
                downloadedFilePath = pathMatch
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

      return YtdlpTool.resolveDownloadedMediaPath(downloadedFilePath, target)
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
      const target = YtdlpTool.resolveSubtitleOutputTarget(
        outputPath,
        languageCode
      )
      mkdirSync(target.directoryPath, { recursive: true })

      const result = await this.executeCommand({
        binaryName: 'yt-dlp',
        args: [
          ...this.getConfigArgs(),
          videoUrl,
          '--write-subs',
          '--write-auto-subs',
          '--sub-langs',
          languageCode,
          '--sub-format',
          SUBTITLE_FORMAT,
          '--convert-subs',
          SUBTITLE_CONVERT_FORMAT,
          '--skip-download',
          '-o',
          YtdlpTool.buildTypedOutputTemplate(
            SUBTITLE_OUTPUT_TYPE,
            target.outputTemplate
          )
        ],
        options: { sync: true }
      })

      return YtdlpTool.resolveDownloadedSubtitlePath(result, target)
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
      const target = YtdlpTool.resolveMediaOutputTarget(outputPath)
      mkdirSync(target.directoryPath, { recursive: true })

      const result = await this.executeCommand({
        binaryName: 'yt-dlp',
        args: [
          ...this.getConfigArgs(),
          videoUrl,
          '--embed-thumbnail',
          '--write-thumbnail',
          '-o',
          target.outputTemplate
        ],
        options: { sync: true }
      })

      return YtdlpTool.resolveDownloadedMediaPath(result, target)
    } catch (error: unknown) {
      throw new Error(
        `Video with thumbnail download failed: ${(error as Error).message}`
      )
    }
  }
}

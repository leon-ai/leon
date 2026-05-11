import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'

import { Tool, type ProgressCallback } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const DEFAULT_SETTINGS: Record<string, unknown> = {}
const REQUIRED_SETTINGS: string[] = []
const DOWNLOAD_DESTINATION_PATTERN = /Destination:\s+(.+)$/
const ALREADY_DOWNLOADED_PATTERN =
  /\[download\]\s+(.+)\s+has already been downloaded/
const MERGED_FILE_PATTERN = /\[Merger\]\s+Merging formats into\s+"(.+)"$/
const SUBTITLE_DESTINATION_PATTERN =
  /Writing (?:video subtitles|video automatic captions) to:\s+(.+)$/
const DOWNLOAD_PROGRESS_PATTERN =
  /\[download\]\s+(\d+\.?\d*)%\s+of\s+(?:~?\s*)([\d.]+\w+)\s+at\s+([\d.]+\w+\/s)\s+ETA\s+([\d:]+)/
const YTDLP_EXT_TEMPLATE = '%(ext)s'
const YTDLP_TITLE_TEMPLATE = '%(title)s'
const YTDLP_PLAYLIST_INDEX_TEMPLATE = '%(playlist_index)s'
const SUBTITLE_FORMAT = 'srt/best'
const SUBTITLE_CONVERT_FORMAT = 'srt'
const IGNORED_MEDIA_OUTPUT_EXTENSIONS = new Set([
  '.part',
  '.ytdl',
  '.tmp',
  '.temp',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.json'
])
const LANGUAGE_CODE_SEPARATOR = ','
const SUBTITLE_OUTPUT_TYPE = 'subtitle'
const TYPED_OUTPUT_SEPARATOR = ':'
const SUBTITLE_METADATA_LANGUAGE_FIELDS = [
  'language',
  'language_code',
  'original_language'
]
const IGNORED_SUBTITLE_LANGUAGE_CODES = new Set(['live_chat'])

interface OutputTarget {
  directoryPath: string
  outputTemplate: string
  predictedFilePath?: string
}

interface VideoMetadata {
  language?: unknown
  language_code?: unknown
  original_language?: unknown
  subtitles?: unknown
  automatic_captions?: unknown
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
    let parsedPath: string | null = null

    for (const line of output.split('\n')) {
      const match =
        line.match(DOWNLOAD_DESTINATION_PATTERN) ||
        line.match(ALREADY_DOWNLOADED_PATTERN) ||
        line.match(MERGED_FILE_PATTERN) ||
        line.match(SUBTITLE_DESTINATION_PATTERN)

      if (match?.[1]) {
        parsedPath = match[1].trim()
      }
    }

    return parsedPath
  }

  private static asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null
    }

    return value as Record<string, unknown>
  }

  private static getMetadataLanguageCodes(value: unknown): string[] {
    const record = this.asRecord(value)
    if (!record) {
      return []
    }

    return Object.keys(record)
      .map((languageCode) => languageCode.trim())
      .filter((languageCode) =>
        Boolean(languageCode) &&
        !IGNORED_SUBTITLE_LANGUAGE_CODES.has(languageCode)
      )
  }

  private static getVideoLanguageCandidates(metadata: VideoMetadata): string[] {
    const languageCodes = SUBTITLE_METADATA_LANGUAGE_FIELDS
      .map((field) => metadata[field as keyof VideoMetadata])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean)

    return [...new Set(languageCodes)]
  }

  private static selectMatchingLanguage(
    requestedLanguageCode: string,
    availableLanguageCodes: string[]
  ): string | null {
    const normalizedRequested = requestedLanguageCode.trim().toLowerCase()
    if (!normalizedRequested) {
      return null
    }

    return (
      availableLanguageCodes.find((languageCode) => {
        const normalizedLanguageCode = languageCode.toLowerCase()
        return (
          normalizedLanguageCode === normalizedRequested ||
          normalizedLanguageCode.startsWith(`${normalizedRequested}-`) ||
          normalizedRequested.startsWith(`${normalizedLanguageCode}-`)
        )
      }) || null
    )
  }

  private static selectSubtitleLanguage(
    metadata: VideoMetadata,
    requestedLanguageCode?: string
  ): string {
    const subtitleLanguageCodes = this.getMetadataLanguageCodes(
      metadata.subtitles
    )
    const automaticCaptionLanguageCodes = this.getMetadataLanguageCodes(
      metadata.automatic_captions
    )
    const requested = requestedLanguageCode?.trim()

    if (requested) {
      return (
        this.selectMatchingLanguage(requested, subtitleLanguageCodes) ||
        this.selectMatchingLanguage(requested, automaticCaptionLanguageCodes) ||
        requested
      )
    }

    for (const languageCode of this.getVideoLanguageCandidates(metadata)) {
      const matchingLanguageCode =
        this.selectMatchingLanguage(languageCode, subtitleLanguageCodes) ||
        this.selectMatchingLanguage(languageCode, automaticCaptionLanguageCodes)

      if (matchingLanguageCode) {
        return matchingLanguageCode
      }
    }

    if (subtitleLanguageCodes.length > 0) {
      return subtitleLanguageCodes[0]!
    }

    if (automaticCaptionLanguageCodes.length > 0) {
      return automaticCaptionLanguageCodes[0]!
    }

    throw new Error(
      'No subtitles or automatic captions are available for this video.'
    )
  }

  /**
   * Finds the newest file created or updated in the output directory.
   */
  private static findNewestOutputFile(
    directoryPath: string,
    startedAtMs?: number
  ): string | null {
    if (!existsSync(directoryPath) || !statSync(directoryPath).isDirectory()) {
      return null
    }

    const minModifiedTime = startedAtMs ? startedAtMs - 2_000 : 0
    let newestPath: string | null = null
    let newestModifiedTime = 0

    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue
      }

      const candidatePath = join(directoryPath, entry.name)
      if (IGNORED_MEDIA_OUTPUT_EXTENSIONS.has(extname(candidatePath))) {
        continue
      }

      const stats = statSync(candidatePath)

      if (stats.mtimeMs < minModifiedTime) {
        continue
      }

      if (stats.mtimeMs >= newestModifiedTime) {
        newestPath = candidatePath
        newestModifiedTime = stats.mtimeMs
      }
    }

    return newestPath
  }

  /**
   * Resolves a media path from yt-dlp output or a deterministic file target.
   */
  private static resolveDownloadedMediaPath(
    output: string,
    target: OutputTarget,
    startedAtMs?: number
  ): string {
    if (target.predictedFilePath && existsSync(target.predictedFilePath)) {
      return target.predictedFilePath
    }

    const parsedPath = this.parseOutputFilePath(output)

    if (parsedPath && existsSync(parsedPath)) {
      return parsedPath
    }

    const newestOutputFile = this.findNewestOutputFile(
      target.directoryPath,
      startedAtMs
    )

    if (newestOutputFile) {
      return newestOutputFile
    }

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
   * Loads video metadata to select the best available subtitle language.
   */
  private async getVideoMetadata(videoUrl: string): Promise<VideoMetadata> {
    const output = await this.executeCommand({
      binaryName: 'yt-dlp',
      args: [...this.getConfigArgs(), videoUrl, '--dump-single-json', '--skip-download'],
      options: { sync: true }
    })

    return JSON.parse(output.trim()) as VideoMetadata
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
      const commandStartedAtMs = Date.now()

      const result = await this.executeCommand({
        binaryName: 'yt-dlp',
        args: [...this.getConfigArgs(), videoUrl, '-o', target.outputTemplate],
        options: { sync: true }
      })

      return YtdlpTool.resolveDownloadedMediaPath(
        result,
        target,
        commandStartedAtMs
      )
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
      const commandStartedAtMs = Date.now()

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

      return YtdlpTool.resolveDownloadedMediaPath(
        result,
        target,
        commandStartedAtMs
      )
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
      const commandStartedAtMs = Date.now()
      let downloadedFilePath = ''

      const result = await this.executeCommand({
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
          const lines = output.split('\n')

          for (const line of lines) {
            // Parse download progress
            if (!isError && line.includes('[download]')) {
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
            if (!isError && line.includes('[download] 100%') && onProgress) {
              onProgress({
                percentage: 100,
                status: 'completed'
              })
            }
          }
        }
      })

      return YtdlpTool.resolveDownloadedMediaPath(
        [downloadedFilePath, result].filter(Boolean).join('\n'),
        target,
        commandStartedAtMs
      )
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
   * @param languageCode Optional language code for the desired subtitles (e.g., 'en', 'fr').
   * @returns A promise that resolves with the file path of the downloaded subtitle file.
   */
  async downloadSubtitles(
    videoUrl: string,
    outputPath: string,
    languageCode?: string
  ): Promise<string> {
    try {
      const resolvedLanguageCode = YtdlpTool.selectSubtitleLanguage(
        await this.getVideoMetadata(videoUrl),
        languageCode
      )
      const target = YtdlpTool.resolveSubtitleOutputTarget(
        outputPath,
        resolvedLanguageCode
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
          resolvedLanguageCode,
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
      const commandStartedAtMs = Date.now()

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

      return YtdlpTool.resolveDownloadedMediaPath(
        result,
        target,
        commandStartedAtMs
      )
    } catch (error: unknown) {
      throw new Error(
        `Video with thumbnail download failed: ${(error as Error).message}`
      )
    }
  }
}

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

/**
 * Represents the overall format information of a media file.
 */
interface MediaFormatInfo {
  filename: string
  nb_streams: number
  format_name: string
  format_long_name: string
  start_time: string
  duration: string
  size: string
  bit_rate: string
  probe_score: number
  tags?: { [key: string]: string }
}

/**
 * Represents detailed information about a single stream within a media file.
 */
interface StreamInfo {
  index: number
  codec_name: string
  codec_long_name: string
  codec_type: 'video' | 'audio' | 'subtitle' | 'data'
  width?: number // For video streams
  height?: number // For video streams
  r_frame_rate?: string // For video streams
  sample_rate?: string // For audio streams
  channels?: number // For audio streams
  [key: string]: unknown // Other properties
}

/**
 * Represents information for a single frame in a video.
 */
interface FrameInfo {
  media_type: 'video' | 'audio'
  stream_index: number
  key_frame: 0 | 1
  pts: number
  pts_time: string
  dts: number
  dts_time: string
  duration: number
  duration_time: string
  size: string
  pos: string

  [key: string]: unknown
}

export default class FfprobeTool extends Tool {
  private static readonly TOOLKIT = 'video_streaming'
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    // Load configuration from central toolkits directory
    // Use class name for tool config name
    const toolConfigName = this.constructor.name
      .toLowerCase()
      .replace('tool', '')
    this.config = ToolkitConfig.load(FfprobeTool.TOOLKIT, toolConfigName)
  }

  get toolName(): string {
    // Dynamic tool name based on class name
    return this.constructor.name
  }

  get toolkit(): string {
    return FfprobeTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Retrieves general format information about a media file.
   * @param filePath - The path to the input media file.
   * @returns A promise that resolves with the media's format information.
   */
  async getMediaFormatInfo(filePath: string): Promise<MediaFormatInfo> {
    try {
      const result = await this.executeCommand({
        binaryName: 'ffprobe',
        args: [
          '-hide_banner',
          '-v',
          'quiet',
          '-print_format',
          'json',
          '-show_format',
          filePath
        ],
        options: { sync: true }
      })

      const data = JSON.parse(result)
      const formatData = data.format || {}

      return {
        filename: formatData.filename || '',
        nb_streams: formatData.nb_streams || 0,
        format_name: formatData.format_name || '',
        format_long_name: formatData.format_long_name || '',
        start_time: formatData.start_time || '',
        duration: formatData.duration || '',
        size: formatData.size || '',
        bit_rate: formatData.bit_rate || '',
        probe_score: formatData.probe_score || 0,
        tags: formatData.tags
      }
    } catch (error: unknown) {
      throw new Error(
        `Failed to get media format info: ${(error as Error).message}`
      )
    }
  }

  /**
   * Lists all streams contained within a media file.
   * @param filePath - The path to the input media file.
   * @returns A promise that resolves with an array of stream information objects.
   */
  async listStreams(filePath: string): Promise<StreamInfo[]> {
    try {
      const result = await this.executeCommand({
        binaryName: 'ffprobe',
        args: [
          '-hide_banner',
          '-v',
          'quiet',
          '-print_format',
          'json',
          '-show_streams',
          filePath
        ],
        options: { sync: true }
      })

      const data = JSON.parse(result)
      const streamsData = data.streams || []

      return streamsData.map(
        (streamData: Record<string, unknown>): StreamInfo => ({
          index: (streamData['index'] as number) || 0,
          codec_name: (streamData['codec_name'] as string) || '',
          codec_long_name: (streamData['codec_long_name'] as string) || '',
          codec_type:
            (streamData['codec_type'] as StreamInfo['codec_type']) || 'data',
          width: streamData['width'] as number,
          height: streamData['height'] as number,
          r_frame_rate: streamData['r_frame_rate'] as string,
          sample_rate: streamData['sample_rate'] as string,
          channels: streamData['channels'] as number,
          ...streamData // Include all other properties
        })
      )
    } catch (error: unknown) {
      throw new Error(`Failed to list streams: ${(error as Error).message}`)
    }
  }

  /**
   * Retrieves detailed information for all video streams in a file.
   * @param filePath - The path to the input media file.
   * @returns A promise that resolves with an array of video stream information objects.
   */
  async getVideoSteamInfo(filePath: string): Promise<StreamInfo[]> {
    try {
      const allStreams = await this.listStreams(filePath)
      return allStreams.filter((stream) => stream.codec_type === 'video')
    } catch (error: unknown) {
      throw new Error(
        `Failed to get video stream info: ${(error as Error).message}`
      )
    }
  }

  /**
   * Retrieves detailed information for all audio streams in a file.
   * @param filePath - The path to the input media file.
   * @returns A promise that resolves with an array of audio stream information objects.
   */
  async getAudioStreamInfo(filePath: string): Promise<StreamInfo[]> {
    try {
      const allStreams = await this.listStreams(filePath)
      return allStreams.filter((stream) => stream.codec_type === 'audio')
    } catch (error: unknown) {
      throw new Error(
        `Failed to get audio stream info: ${(error as Error).message}`
      )
    }
  }

  /**
   * Counts the total number of frames in the primary video stream of a file.
   * @param filePath - The path to the input video file.
   * @returns A promise that resolves with the total frame count.
   */
  async countFrames(filePath: string): Promise<number> {
    try {
      try {
        // Try to get nb_frames first
        const result = await this.executeCommand({
          binaryName: 'ffprobe',
          args: [
            '-hide_banner',
            '-v',
            'error',
            '-select_streams',
            'v:0',
            '-count_frames',
            '-show_entries',
            'stream=nb_frames',
            '-of',
            'csv=p=0',
            filePath
          ],
          options: { sync: true }
        })

        const frameCountStr = result.trim()
        if (frameCountStr && frameCountStr !== 'N/A') {
          return parseInt(frameCountStr, 10)
        }
      } catch {
        // Ignore error, fallback to manual counting
      }

      // Fallback: count frames manually if nb_frames is not available
      const result = await this.executeCommand({
        binaryName: 'ffprobe',
        args: [
          '-hide_banner',
          '-v',
          'error',
          '-select_streams',
          'v:0',
          '-show_entries',
          'frame=n',
          '-of',
          'csv=p=0',
          filePath
        ],
        options: { sync: true }
      })

      const lines = result.trim().split('\n')
      return lines.filter((line) => line.trim()).length
    } catch (error: unknown) {
      throw new Error(`Failed to count frames: ${(error as Error).message}`)
    }
  }

  /**
   * Retrieves detailed, frame-by-frame information from a video stream.
   * @param filePath - The path to the input video file.
   * @returns A promise that resolves with an array of frame information objects.
   */
  async getFramesInfo(filePath: string): Promise<FrameInfo[]> {
    try {
      const result = await this.executeCommand({
        binaryName: 'ffprobe',
        args: [
          '-hide_banner',
          '-v',
          'quiet',
          '-print_format',
          'json',
          '-show_frames',
          '-select_streams',
          'v:0',
          filePath
        ],
        options: { sync: true }
      })

      const data = JSON.parse(result)
      const framesData = data.frames || []

      return framesData.map(
        (frameData: Record<string, unknown>): FrameInfo => ({
          media_type:
            (frameData['media_type'] as FrameInfo['media_type']) || 'video',
          stream_index: (frameData['stream_index'] as number) || 0,
          key_frame: (frameData['key_frame'] as FrameInfo['key_frame']) || 0,
          pts: (frameData['pts'] as number) || 0,
          pts_time: (frameData['pts_time'] as string) || '',
          dts: (frameData['dts'] as number) || 0,
          dts_time: (frameData['dts_time'] as string) || '',
          duration: (frameData['duration'] as number) || 0,
          duration_time: (frameData['duration_time'] as string) || '',
          size: (frameData['size'] as string) || '',
          pos: (frameData['pos'] as string) || '',
          ...frameData // Include all other properties
        })
      )
    } catch (error: unknown) {
      throw new Error(`Failed to get frames info: ${(error as Error).message}`)
    }
  }
}

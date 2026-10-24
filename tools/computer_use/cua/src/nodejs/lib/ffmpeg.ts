import ToolManager from '@sdk/tool-manager'

/**
 * Shares the FFmpeg tool's managed executable for internal capture processing.
 */
export function getFfmpegBinaryPath(): Promise<string> {
  return ToolManager.getToolBinaryPath('video_streaming', 'ffmpeg')
}

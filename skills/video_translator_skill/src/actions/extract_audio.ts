import fs from 'node:fs'
import path from 'node:path'

import type { ActionFunction, ActionParams } from '@sdk/types'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import FfmpegTool from '@sdk/tools/ffmpeg-tool'
import { formatBytes, formatFilePath } from '@sdk/utils'

export const run: ActionFunction = async function (
  _params: ActionParams,
  paramsHelper: ParamsHelper
) {
  // Priority: explicit argument -> context_data
  const videoPath =
    (paramsHelper.getActionArgument('video_path') as string) ||
    paramsHelper.getContextData<string>('video_path')
  const targetLanguage =
    (paramsHelper.getActionArgument('target_language') as string) ||
    paramsHelper.getContextData<string>('target_language')
  const audioFormat =
    (paramsHelper.getActionArgument('audio_format') as string) || 'mp3'

  try {
    // If video_path is not provided as argument, try to get it from memory
    // If still no video path, cannot proceed
    if (!videoPath) {
      leon.answer({
        key: 'no_video_info',
        data: {
          error:
            'No video information found. Provide a video_path or run the download step first.'
        }
      })
      return
    }

    // Initialize ffmpeg tool
    const ffmpegTool = new FfmpegTool()

    // Verify the input video file exists
    if (!fs.existsSync(videoPath)) {
      leon.answer({
        key: 'video_file_not_found',
        data: {
          video_path: formatFilePath(videoPath)
        }
      })

      return
    }

    // Get video file info
    const videoStats = await fs.promises.stat(videoPath)
    const videoSizeMB = formatBytes(videoStats.size)

    const extractionStartedData: Record<string, string> = {
      video_path: formatFilePath(path.basename(videoPath)),
      audio_format: audioFormat,
      video_size: videoSizeMB
    }

    if (targetLanguage) {
      extractionStartedData['target_language'] = targetLanguage
    }

    leon.answer({
      key: 'extraction_started',
      data: extractionStartedData
    })

    // Create output path for audio file
    const videoDir = path.dirname(videoPath)
    const videoName = path.parse(videoPath).name
    const audioPath = path.join(videoDir, `${videoName}_audio.${audioFormat}`)

    // Extract audio using ffmpeg
    const extractedAudioPath = await ffmpegTool.extractAudio(
      videoPath,
      audioPath
    )

    // Verify the extracted audio file exists
    if (!fs.existsSync(extractedAudioPath)) {
      leon.answer({
        key: 'extraction_failed',
        data: {
          video_path: formatFilePath(path.basename(videoPath)),
          error: 'Extracted audio file not found'
        }
      })
      return
    }

    // Get audio file info
    const audioStats = await fs.promises.stat(extractedAudioPath)
    const audioSizeMB = Math.round(audioStats.size / (1_024 * 1_024))

    const extractionCompletedData: Record<string, string> = {
      video_path: path.basename(videoPath),
      audio_path: formatFilePath(extractedAudioPath),
      folder_path: formatFilePath(path.dirname(extractedAudioPath)),
      audio_size: `${audioSizeMB} MB`,
      audio_format: audioFormat
    }

    if (targetLanguage) {
      extractionCompletedData['target_language'] = targetLanguage
    }

    leon.answer({
      key: 'extraction_completed',
      data: extractionCompletedData,
      core: {
        context_data: {
          audio_path: extractedAudioPath,
          audio_format: audioFormat
        }
      }
    })
  } catch (error) {
    leon.answer({
      key: 'extraction_error',
      data: {
        video_path: path.basename(videoPath as string),
        error: (error as Error).message
      }
    })
  }
}

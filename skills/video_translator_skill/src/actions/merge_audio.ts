import fs from 'node:fs'
import path from 'node:path'

import type { ActionFunction, ActionParams } from '@sdk/types'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import ToolManager, { isMissingToolSettingsError } from '@sdk/tool-manager'
import FfmpegTool from '@tools/video_streaming/ffmpeg'
import {
  formatBytes,
  formatFilePath,
  normalizeLanguageCode
} from '@sdk/utils'

function getLanguageDisplayName(languageCode: string): string {
  try {
    return (
      new Intl.DisplayNames(['en'], { type: 'language' }).of(languageCode) ||
      languageCode
    )
  } catch {
    return languageCode
  }
}

export const run: ActionFunction = async function (
  _params: ActionParams,
  paramsHelper: ParamsHelper
) {
  // Priority: explicit argument -> context_data
  const videoPath =
    (paramsHelper.getActionArgument('video_path') as string) ||
    paramsHelper.getContextData<string>('video_path')
  const dubbedAudioPath =
    (paramsHelper.getActionArgument('dubbed_audio_path') as string) ||
    paramsHelper.getContextData<string>('dubbed_audio_path')
  const instrumentalPath =
    (paramsHelper.getActionArgument('instrumental_path') as string) ||
    paramsHelper.getContextData<string>('instrumental_path')

  const targetLanguage =
    paramsHelper.getContextData<string>('target_language_code') ||
    normalizeLanguageCode(paramsHelper.getContextData<string>('target_language') || '')
  const targetLanguageLabel =
    paramsHelper.getContextData<string>('target_language') ||
    (targetLanguage ? getLanguageDisplayName(targetLanguage) : undefined)

  try {
    // Validate required inputs
    if (!videoPath) {
      leon.answer({
        key: 'no_video_path',
        data: {
          error:
            'No video path found. Please provide a video_path or run the download_video action first.'
        }
      })
      return
    }

    if (!dubbedAudioPath) {
      leon.answer({
        key: 'no_dubbed_audio_path',
        data: {
          error:
            'No dubbed audio path found. Please provide a dubbed_audio_path or run the create_new_audio action first.'
        }
      })
      return
    }

    // Verify video file exists
    if (!fs.existsSync(videoPath)) {
      leon.answer({
        key: 'video_file_not_found',
        data: {
          video_path: formatFilePath(videoPath)
        }
      })
      return
    }

    // Verify dubbed audio file exists
    if (!fs.existsSync(dubbedAudioPath)) {
      leon.answer({
        key: 'dubbed_audio_file_not_found',
        data: {
          dubbed_audio_path: formatFilePath(dubbedAudioPath)
        }
      })
      return
    }

    // Initialize ffmpeg tool
    const ffmpegTool = await ToolManager.initTool(FfmpegTool)

    let finalAudioPath = dubbedAudioPath

    // If instrumental path is available, merge it with the dubbed audio
    if (instrumentalPath && fs.existsSync(instrumentalPath)) {
      const audioDir = path.dirname(dubbedAudioPath)
      const audioName = path.parse(dubbedAudioPath).name
      const mergedAudioPath = path.join(
        audioDir,
        `${audioName}_with_instrumental.wav`
      )

      leon.answer({
        key: 'merging_with_instrumental'
      })

      await ffmpegTool.mergeAudio(
        dubbedAudioPath,
        instrumentalPath,
        mergedAudioPath
      )

      if (fs.existsSync(mergedAudioPath)) {
        finalAudioPath = mergedAudioPath
      }
    }

    // Get file info for user feedback
    const videoStats = await fs.promises.stat(videoPath)
    const videoSizeMB = formatBytes(videoStats.size)
    const finalAudioStats = await fs.promises.stat(finalAudioPath)
    const finalAudioSizeMB = formatBytes(finalAudioStats.size)

    const mergeStartedData: Record<string, string> = {
      video_path: formatFilePath(path.basename(videoPath)),
      dubbed_audio_path: formatFilePath(path.basename(finalAudioPath)),
      video_size: videoSizeMB,
      audio_size: finalAudioSizeMB
    }
    if (targetLanguage) {
      mergeStartedData['target_language'] = targetLanguageLabel || targetLanguage
    }

    leon.answer({
      key: 'merge_started',
      data: mergeStartedData
    })

    // Create output path for the merged video
    const videoDir = path.dirname(videoPath)
    const videoName = path.parse(videoPath).name
    const videoExt = path.parse(videoPath).ext
    const languageSuffix = targetLanguage ? `_${targetLanguage}` : '_dubbed'
    const mergedVideoPath = path.join(
      videoDir,
      `${videoName}${languageSuffix}${videoExt}`
    )

    // Replace the original audio with the final audio (dubbed + instrumental)
    const outputVideoPath = await ffmpegTool.replaceVideoAudio(
      videoPath,
      finalAudioPath,
      mergedVideoPath
    )

    // Verify the merged video file exists
    if (!fs.existsSync(outputVideoPath)) {
      leon.answer({
        key: 'merge_failed',
        data: {
          video_path: formatFilePath(path.basename(videoPath)),
          error: 'Merged video file not found after processing'
        }
      })
      return
    }

    // Get merged video file info
    const mergedStats = await fs.promises.stat(outputVideoPath)
    const mergedSizeMB = formatBytes(mergedStats.size)

    const mergeCompletedData: Record<string, string> = {
      merged_video_path: formatFilePath(outputVideoPath),
      folder_path: formatFilePath(path.dirname(outputVideoPath)),
      merged_size: mergedSizeMB,
      original_video: path.basename(videoPath),
      dubbed_audio: path.basename(finalAudioPath)
    }
    if (targetLanguage) {
      mergeCompletedData['target_language'] =
        targetLanguageLabel || targetLanguage
    }

    leon.answer({
      key: 'merge_completed',
      data: mergeCompletedData,
      core: {
        context_data: {
          merged_video_path: outputVideoPath,
          target_language: targetLanguageLabel || targetLanguage,
          target_language_code: targetLanguage
        }
      }
    })
  } catch (error) {
    if (isMissingToolSettingsError(error)) {
      return
    }
    leon.answer({
      key: 'merge_error',
      data: {
        error: (error as Error).message
      },
      core: {
        should_stop_skill: true
      }
    })
  }
}

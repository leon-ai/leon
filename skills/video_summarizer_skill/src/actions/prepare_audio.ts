import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

import type { ActionFunction, ActionParams } from '@sdk/types'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import ToolManager, { isMissingToolSettingsError } from '@sdk/tool-manager'
import FfmpegTool from '@tools/video_streaming/ffmpeg'
import YtdlpTool from '@tools/video_streaming/ytdlp'
import { formatFilePath } from '@sdk/utils'

const isHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.m4a',
  '.wav',
  '.flac',
  '.aac',
  '.ogg',
  '.opus'
])

export const run: ActionFunction = async function (
  _params: ActionParams,
  paramsHelper: ParamsHelper
) {
  const videoSource = paramsHelper.getActionArgument('video_source') as
    | string
    | undefined
  const audioFormat =
    (paramsHelper.getActionArgument('audio_format') as string | undefined) ||
    'mp3'
  const summaryLanguage = paramsHelper.getActionArgument('summary_language') as
    | string
    | undefined

  if (!videoSource) {
    leon.answer({ key: 'missing_video_source' })
    return
  }

  try {
    leon.answer({
      key: 'preparing_audio',
      data: {
        video_source: videoSource,
        audio_format: audioFormat
      }
    })

    let audioPath: string

    if (isHttpUrl(videoSource)) {
      const ytdlpTool = await ToolManager.initTool(YtdlpTool)
      const tempDir = path.join(
        tmpdir(),
        'video_summarizer',
        Date.now().toString()
      )
      await fs.promises.mkdir(tempDir, { recursive: true })

      audioPath = await ytdlpTool.downloadAudioOnly(
        videoSource,
        tempDir,
        audioFormat
      )

      if (!fs.existsSync(audioPath)) {
        leon.answer({
          key: 'download_failed',
          data: {
            video_source: videoSource,
            error: 'Downloaded audio file not found'
          }
        })
        return
      }
    } else {
      if (!fs.existsSync(videoSource)) {
        leon.answer({
          key: 'video_source_not_found',
          data: { video_source: formatFilePath(videoSource) }
        })
        return
      }

      const extension = path.extname(videoSource).toLowerCase()
      if (AUDIO_EXTENSIONS.has(extension)) {
        audioPath = videoSource
      } else {
        const ffmpegTool = await ToolManager.initTool(FfmpegTool)
        const tempDir = path.join(
          tmpdir(),
          'video_summarizer',
          Date.now().toString()
        )
        await fs.promises.mkdir(tempDir, { recursive: true })
        const videoName = path.parse(videoSource).name
        const extractedAudioPath = path.join(
          tempDir,
          `${videoName}_audio.${audioFormat}`
        )

        audioPath = await ffmpegTool.extractAudio(
          videoSource,
          extractedAudioPath
        )

        if (!fs.existsSync(audioPath)) {
          leon.answer({
            key: 'audio_extraction_failed',
            data: {
              video_source: videoSource,
              error: 'Extracted audio file not found'
            }
          })
          return
        }
      }
    }

    leon.answer({
      key: 'audio_ready',
      data: {
        audio_path: formatFilePath(audioPath)
      },
      core: {
        context_data: {
          audio_path: audioPath,
          audio_format: audioFormat,
          summary_language: summaryLanguage
        }
      }
    })
  } catch (error) {
    if (isMissingToolSettingsError(error)) {
      return
    }
    const errorMessage = (error as Error).message
    leon.answer({
      key: isHttpUrl(videoSource)
        ? 'download_failed'
        : 'audio_extraction_failed',
      data: {
        video_source: videoSource,
        error: errorMessage
      },
      core: {
        should_stop_skill: true
      }
    })
  }
}

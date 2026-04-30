import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

import type { ActionFunction, ActionParams } from '@sdk/types'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import ToolManager, { isMissingToolSettingsError } from '@sdk/tool-manager'
import YtdlpTool from '@tools/video_streaming/ytdlp'
import { formatFilePath, normalizeLanguageCode } from '@sdk/utils'

import { DownloadProgressWidget } from '../widgets/download-progress-widget'

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
  /*return leon.answer({
    key: 'download_completed',
    core: {
      context_data: {
        video_path:
          '/tmp/video_translator/1767687261298/DuckDB in 100 Seconds.mp4',
        target_language: 'French',
        quality: '480p'
      }
    }
  })*/

  const videoUrl = paramsHelper.getActionArgument('video_url') as string
  const targetLanguageInput = paramsHelper.getActionArgument(
    'target_language'
  ) as string
  const quality =
    (paramsHelper.getActionArgument('quality') as string) || 'best'
  const targetLanguageCode = normalizeLanguageCode(targetLanguageInput)
  const targetLanguageLabel = targetLanguageCode
    ? getLanguageDisplayName(targetLanguageCode)
    : targetLanguageInput

  try {
    if (!targetLanguageCode) {
      leon.answer({
        key: 'download_error',
        data: {
          video_url: videoUrl,
          error: 'Target language must be a valid ISO 639-1 code.'
        },
        core: {
          should_stop_skill: true
        }
      })
      return
    }

    // Initialize yt-dlp tool
    const ytdlpTool = await ToolManager.initTool(YtdlpTool)

    // Create temporary directory for downloads
    const tempDir = path.join(
      tmpdir(),
      'video_translator',
      Date.now().toString()
    )
    await fs.promises.mkdir(tempDir, { recursive: true })

    await leon.answer({
      key: 'download_started',
      data: {
        video_url: videoUrl,
        target_language: targetLanguageLabel,
        quality: quality
      }
    })

    // Create initial progress widget
    const progressWidget = new DownloadProgressWidget({
      params: {
        videoUrl,
        targetLanguage: targetLanguageLabel,
        quality,
        percentage: 0,
        status: 'initializing',
        speed: '',
        eta: '',
        size: ''
      }
    })

    // Show initial progress widget and capture the message ID
    const progressMessageId = await leon.answer({
      widget: progressWidget,
      key: 'download_progress',
      data: {
        percentage: 0,
        speed: '',
        eta: '',
        size: ''
      },
      widgetHistoryMode: 'system_widget'
    })

    // Track last progress update to avoid too many messages
    let lastProgressUpdate = 0
    let lastPercentage = 0

    // Download video with specified quality and progress reporting
    const downloadedVideoPath = await ytdlpTool.downloadVideoByQuality(
      videoUrl,
      tempDir,
      quality,
      async (progress) => {
        const currentPercentage = progress.percentage || 0
        const now = Date.now()

        // Send updates every 2 seconds or every 5% progress for smooth updates
        if (
          now - lastProgressUpdate > 2_000 ||
          currentPercentage - lastPercentage >= 5
        ) {
          // Create updated progress widget
          const updatedProgressWidget = new DownloadProgressWidget({
            params: {
              videoUrl,
              targetLanguage: targetLanguageLabel,
              quality,
              percentage: currentPercentage,
              status: progress.status || 'downloading',
              speed: progress.speed || '',
              eta: progress.eta || '',
              size: progress.size || ''
            }
          })

          // Keep the same widget ID for consistency
          updatedProgressWidget.id = progressWidget.id

          // Replace the previous progress message using the captured message ID
          await leon.answer({
            widget: updatedProgressWidget,
            key: 'download_progress',
            data: {
              percentage: currentPercentage,
              speed: progress.speed || '',
              eta: progress.eta || '',
              size: progress.size || ''
            },
            replaceMessageId: progressMessageId,
            widgetHistoryMode: 'system_widget'
          })

          lastProgressUpdate = now
          lastPercentage = currentPercentage
        }
      }
    )

    // Send final completion update
    const completedProgressWidget = new DownloadProgressWidget({
      params: {
        videoUrl,
        targetLanguage: targetLanguageLabel,
        quality,
        percentage: 100,
        status: 'completed',
        speed: '',
        eta: '',
        size: ''
      }
    })
    completedProgressWidget.id = progressWidget.id

    // Replace with final completed state
    await leon.answer({
      widget: completedProgressWidget,
      key: 'download_progress',
      data: {
        percentage: 100,
        speed: '',
        eta: '',
        size: ''
      },
      replaceMessageId: progressMessageId,
      widgetHistoryMode: 'system_widget'
    })

    // Verify the downloaded file exists
    if (!fs.existsSync(downloadedVideoPath)) {
      leon.answer({
        key: 'download_failed',
        data: {
          video_url: videoUrl,
          error: 'Downloaded file not found'
        }
      })

      return
    }

    // Get file size for user feedback
    const stats = await fs.promises.stat(downloadedVideoPath)
    const fileSizeMB = Math.round(stats.size / (1_024 * 1_024))
    const targetFolder = path.dirname(downloadedVideoPath)

    leon.answer({
      key: 'download_completed',
      data: {
        video_url: videoUrl,
        file_path: formatFilePath(targetFolder),
        file_size: `${fileSizeMB} MB`,
        target_language: targetLanguageLabel,
        quality: quality
      },
      core: {
        context_data: {
          video_path: downloadedVideoPath,
          target_language: targetLanguageLabel,
          target_language_code: targetLanguageCode,
          quality: quality
        }
      }
    })
  } catch (error) {
    if (isMissingToolSettingsError(error)) {
      return
    }
    leon.answer({
      key: 'download_error',
      data: {
        video_url: videoUrl,
        error: (error as Error).message
      },
      core: {
        should_stop_skill: true
      }
    })
  }
}

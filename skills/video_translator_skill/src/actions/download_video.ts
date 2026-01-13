import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

import type { ActionFunction, ActionParams } from '@sdk/types'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import YtdlpTool from '@sdk/tools/ytdlp-tool'
import { formatFilePath } from '@sdk/utils'

import { DownloadProgressWidget } from '../widgets/download-progress-widget'

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
  const targetLanguage = paramsHelper.getActionArgument(
    'target_language'
  ) as string
  const quality =
    (paramsHelper.getActionArgument('quality') as string) || 'best'

  try {
    // Initialize yt-dlp tool
    const ytdlpTool = new YtdlpTool()

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
        target_language: targetLanguage,
        quality: quality
      }
    })

    // Create initial progress widget
    const progressWidget = new DownloadProgressWidget({
      params: {
        videoUrl,
        targetLanguage,
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
      widget: progressWidget
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
              targetLanguage,
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
            replaceMessageId: progressMessageId
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
        targetLanguage,
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
      replaceMessageId: progressMessageId
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
        target_language: targetLanguage,
        quality: quality
      },
      core: {
        context_data: {
          video_path: downloadedVideoPath,
          target_language: targetLanguage,
          quality: quality
        }
      }
    })
  } catch (error) {
    leon.answer({
      key: 'download_error',
      data: {
        video_url: videoUrl,
        error: (error as Error).message
      }
    })
  }
}

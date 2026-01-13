import fs from 'node:fs'
import path from 'node:path'

import type { ActionFunction, ActionParams } from '@sdk/types'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import { Settings } from '@sdk/settings'
import ElevenLabsAudioTool from '@sdk/tools/elevenlabs_audio-tool'
import { formatBytes, formatFilePath } from '@sdk/utils'

interface MusicAudioToolkitSkillSettings extends Record<string, unknown> {
  elevenlabs_dubbing_api_key?: string
  elevenlabs_dubbing_source_lang?: string
  elevenlabs_dubbing_num_speakers?: number
  elevenlabs_dubbing_watermark?: boolean
  elevenlabs_dubbing_poll_interval?: number
}

export const run: ActionFunction = async function (
  _params: ActionParams,
  paramsHelper: ParamsHelper
) {
  const audioPathArg =
    paramsHelper.getActionArgument('audio_path') ||
    (paramsHelper.findActionArgumentFromContext('audio_path') as string)
  const targetLanguage =
    (paramsHelper.getActionArgument('target_language') as string) ||
    paramsHelper.getContextData<string>('target_language')
  const targetLanguageISOCode =
    paramsHelper
      .findAllEntitiesFromContext('language')[0]
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      ?.option.slice(0, 2) || null

  try {
    const settings = new Settings<MusicAudioToolkitSkillSettings>()
    const elevenlabsApiKey = (await settings.get(
      'elevenlabs_dubbing_api_key'
    )) as string | undefined
    const sourceLang = ((await settings.get(
      'elevenlabs_dubbing_source_lang'
    )) || 'auto') as string
    const numSpeakers = ((await settings.get(
      'elevenlabs_dubbing_num_speakers'
    )) || 0) as number
    const watermark = ((await settings.get('elevenlabs_dubbing_watermark')) ||
      false) as boolean
    const pollInterval = ((await settings.get(
      'elevenlabs_dubbing_poll_interval'
    )) || 10_000) as number // Default 10 seconds

    const audioPath = audioPathArg || paramsHelper.getContextData('audio_path')

    if (!audioPath || !fs.existsSync(audioPath)) {
      leon.answer({
        key: 'audio_not_found'
      })
      return
    }

    if (!targetLanguage) {
      leon.answer({
        key: 'target_language_missing'
      })
      return
    }

    if (!elevenlabsApiKey) {
      leon.answer({
        key: 'missing_api_key'
      })
      return
    }

    // Get file info
    const audioStats = await fs.promises.stat(audioPath)
    const audioSizeMB = formatBytes(audioStats.size)
    const audioDir = path.dirname(audioPath)
    const audioName = path.parse(audioPath).name
    const audioExt = path.parse(audioPath).ext

    leon.answer({
      key: 'dubbing_started',
      data: {
        audio_path: formatFilePath(audioPath),
        target_language: targetLanguage,
        source_language: sourceLang,
        file_size: audioSizeMB,
        num_speakers: numSpeakers === 0 ? 'auto-detect' : numSpeakers.toString()
      }
    })

    // Initialize ElevenLabs tool
    const tool = new ElevenLabsAudioTool()

    // Create dubbing project
    const dubbingResponse = await tool.createDubbing(
      audioPath,
      targetLanguageISOCode,
      elevenlabsApiKey,
      sourceLang,
      numSpeakers,
      watermark
    )

    const dubbingId = dubbingResponse.dubbing_id
    const expectedDuration = Math.round(dubbingResponse.expected_duration_sec)

    leon.answer({
      key: 'dubbing_created',
      data: {
        dubbing_id: dubbingId,
        expected_duration: `${expectedDuration}s`,
        target_language: targetLanguage
      }
    })

    // Poll for dubbing completion
    let status = 'dubbing'
    let pollCount = 0
    const maxPolls = 120 // Max 20 minutes with 10s interval

    while (status === 'dubbing' && pollCount < maxPolls) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
      pollCount++

      const statusResponse = await tool.getDubbingStatus(
        dubbingId,
        elevenlabsApiKey
      )
      status = statusResponse.status

      // Report progress every 3 polls (30 seconds with default interval)
      if (pollCount % 3 === 0) {
        leon.answer({
          key: 'dubbing_progress',
          data: {
            status,
            elapsed_time: `${Math.round((pollCount * pollInterval) / 1000)}s`,
            dubbing_id: dubbingId
          }
        })
      }

      if (status === 'failed') {
        leon.answer({
          key: 'dubbing_failed',
          data: {
            dubbing_id: dubbingId,
            error: statusResponse.error || 'Unknown error'
          }
        })
        return
      }
    }

    if (status === 'dubbing') {
      leon.answer({
        key: 'dubbing_timeout',
        data: {
          dubbing_id: dubbingId,
          elapsed_time: `${Math.round((pollCount * pollInterval) / 1_000)}s`
        }
      })
      return
    }

    // Download dubbed file
    // Determine output file extension
    const isVideo = ['.mp4', '.avi', '.mov', '.mkv', '.webm'].includes(
      audioExt.toLowerCase()
    )
    const outputExt = isVideo ? '.mp4' : '.mp3'
    const dubbedPath = path.join(
      audioDir,
      `${audioName}_${targetLanguage}${outputExt}`
    )

    await tool.downloadDubbedFile(
      dubbingId,
      targetLanguageISOCode,
      dubbedPath,
      elevenlabsApiKey
    )

    // Verify the dubbed file exists
    if (!fs.existsSync(dubbedPath)) {
      leon.answer({
        key: 'dubbing_download_failed',
        data: {
          dubbing_id: dubbingId,
          error: 'Downloaded file not found'
        }
      })
      return
    }

    // Get dubbed file info
    const dubbedStats = await fs.promises.stat(dubbedPath)
    const dubbedSizeMB = formatBytes(dubbedStats.size)

    leon.answer({
      key: 'dubbing_completed',
      data: {
        dubbed_path: formatFilePath(dubbedPath),
        target_language: targetLanguage,
        file_size: dubbedSizeMB,
        dubbing_id: dubbingId
      },
      core: {
        context_data: {
          dubbed_path: dubbedPath,
          dubbing_id: dubbingId
        }
      }
    })
  } catch (error) {
    leon.answer({
      key: 'dubbing_error',
      data: { error: (error as Error).message }
    })
  }
}

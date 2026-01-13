import fs from 'node:fs'
import path from 'node:path'

import type { ActionFunction, ActionParams } from '@sdk/types'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import { Settings } from '@sdk/settings'
import FasterWhisperTool from '@sdk/tools/faster_whisper-tool'
import OpenAIAudioTool from '@sdk/tools/openai_audio-tool'
import AssemblyAIAudioTool from '@sdk/tools/assemblyai_audio-tool'
import ElevenLabsAudioTool from '@sdk/tools/elevenlabs_audio-tool'
import { formatFilePath } from '@sdk/utils'

interface MusicAudioToolkitSkillSettings extends Record<string, unknown> {
  transcription_provider:
    | 'faster_whisper'
    | 'openai_audio'
    | 'assemblyai_audio'
    | 'elevenlabs_audio'
  faster_whisper_device?: 'auto' | 'cpu' | 'cuda'
  faster_whisper_cpu_threads?: number
  openai_transcription_api_key?: string
  openai_transcription_model?: string
  assemblyai_transcription_api_key?: string
  elevenlabs_transcription_api_key?: string
  elevenlabs_transcription_model?: string
  elevenlabs_transcription_diarize?: boolean
}

export const run: ActionFunction = async function (
  _params: ActionParams,
  paramsHelper: ParamsHelper
) {
  /*return leon.answer({
    key: 'transcription_completed',
    data: {
      transcription_path: formatFilePath(
        '/tmp/video_translator/1767687261298/DuckDB in 100 Seconds_audio_transcription.json'
      )
    },
    core: {
      context_data: {
        transcription_path:
          '/tmp/video_translator/1767687261298/DuckDB in 100 Seconds_audio_transcription.json'
      }
    }
  })*/

  const audioPathArg =
    paramsHelper.getActionArgument('audio_path') ||
    (paramsHelper.findActionArgumentFromContext('audio_path') as string)

  try {
    const settings = new Settings<MusicAudioToolkitSkillSettings>()
    const provider = ((await settings.get('transcription_provider')) ||
      'faster_whisper') as MusicAudioToolkitSkillSettings['transcription_provider']
    const fasterWhisperDevice = ((await settings.get(
      'faster_whisper_device'
    )) || 'auto') as NonNullable<
      MusicAudioToolkitSkillSettings['faster_whisper_device']
    >
    const fasterWhisperCPUThreads = (await settings.get(
      'faster_whisper_cpu_threads'
    )) as number | undefined
    const openaiAPIKey = (await settings.get(
      'openai_transcription_api_key'
    )) as string | undefined
    const openaiModel = ((await settings.get('openai_transcription_model')) ||
      'whisper-1') as string
    const assemblyaiAPIKey = (await settings.get(
      'assemblyai_transcription_api_key'
    )) as string | undefined
    const elevenlabsAPIKey = (await settings.get(
      'elevenlabs_transcription_api_key'
    )) as string | undefined
    const elevenlabsModel = ((await settings.get(
      'elevenlabs_transcription_model'
    )) || 'scribe_v1') as string
    const elevenlabsDiarize = ((await settings.get(
      'elevenlabs_transcription_diarize'
    )) ?? true) as boolean

    const audioPath = audioPathArg || paramsHelper.getContextData('audio_path')

    if (!audioPath || !fs.existsSync(audioPath)) {
      leon.answer({
        key: 'audio_not_found'
      })
      return
    }

    const audioDir = path.dirname(audioPath)
    const audioName = path.parse(audioPath).name
    const transcriptionPath = path.join(
      audioDir,
      `${audioName}_transcription.json`
    )

    leon.answer({
      key: 'transcription_started',
      data: {
        audio_path: formatFilePath(audioPath),
        provider
      }
    })

    if (provider === 'faster_whisper') {
      const tool = new FasterWhisperTool()
      await tool.transcribeToFile(
        audioPath,
        transcriptionPath,
        fasterWhisperDevice,
        fasterWhisperCPUThreads
      )
    } else if (provider === 'openai_audio') {
      if (!openaiAPIKey) {
        leon.answer({ key: 'missing_api_key' })
        return
      }

      const tool = new OpenAIAudioTool()
      await tool.transcribeToFile(
        audioPath,
        transcriptionPath,
        openaiAPIKey,
        openaiModel
      )
    } else if (provider === 'assemblyai_audio') {
      if (!assemblyaiAPIKey) {
        leon.answer({ key: 'missing_api_key' })
        return
      }

      const tool = new AssemblyAIAudioTool()
      await tool.transcribeToFile(
        audioPath,
        transcriptionPath,
        assemblyaiAPIKey
      )
    } else if (provider === 'elevenlabs_audio') {
      if (!elevenlabsAPIKey) {
        leon.answer({ key: 'missing_api_key' })
        return
      }

      const tool = new ElevenLabsAudioTool()
      await tool.transcribeToFile(
        audioPath,
        transcriptionPath,
        elevenlabsAPIKey,
        elevenlabsModel,
        elevenlabsDiarize
      )
    } else {
      leon.answer({ key: 'provider_not_supported' })
      return
    }

    if (!fs.existsSync(transcriptionPath)) {
      leon.answer({
        key: 'transcription_error',
        data: { error: 'Transcription file not found' }
      })
      return
    }

    leon.answer({
      key: 'transcription_completed',
      data: {
        transcription_path: formatFilePath(transcriptionPath)
      },
      core: {
        context_data: {
          transcription_path: transcriptionPath
        }
      }
    })
  } catch (error) {
    leon.answer({
      key: 'transcription_error',
      data: { error: (error as Error).message }
    })
  }
}

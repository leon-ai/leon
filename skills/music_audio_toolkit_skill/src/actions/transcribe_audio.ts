import fs from 'node:fs'
import path from 'node:path'

import type { ActionFunction, ActionParams } from '@sdk/types'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import { Settings } from '@sdk/settings'
import ToolManager, { isMissingToolSettingsError } from '@sdk/tool-manager'
import FasterWhisperTool from '@tools/music_audio/faster_whisper'
import Qwen3ASRTool from '@tools/music_audio/qwen3_asr'
import OpenAIAudioTool from '@tools/music_audio/openai_audio'
import AssemblyAIAudioTool from '@tools/music_audio/assemblyai_audio'
import ElevenLabsAudioTool from '@tools/music_audio/elevenlabs_audio'
import { formatFilePath } from '@sdk/utils'

interface MusicAudioToolkitSkillSettings extends Record<string, unknown> {
  transcription_provider:
    | 'faster_whisper'
    | 'qwen3_asr'
    | 'openai_audio'
    | 'assemblyai_audio'
    | 'elevenlabs_audio'
  faster_whisper_device?: 'auto' | 'cpu' | 'cuda'
  faster_whisper_cpu_threads?: number
  qwen3_asr_device?: 'auto' | 'cpu' | 'cuda'
  openai_transcription_model?: string
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
    const qwen3ASRDevice = ((await settings.get('qwen3_asr_device')) ||
      'auto') as NonNullable<MusicAudioToolkitSkillSettings['qwen3_asr_device']>
    const openaiModel = ((await settings.get('openai_transcription_model')) ||
      'whisper-1') as string
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
      const tool = await ToolManager.initTool(FasterWhisperTool)
      await tool.transcribeToFile(
        audioPath,
        transcriptionPath,
        fasterWhisperDevice,
        fasterWhisperCPUThreads
      )
    } else if (provider === 'qwen3_asr') {
      const tool = await ToolManager.initTool(Qwen3ASRTool)
      await tool.transcribeToFile(audioPath, transcriptionPath, qwen3ASRDevice)
    } else if (provider === 'openai_audio') {
      const tool = await ToolManager.initTool(OpenAIAudioTool)
      await tool.transcribeToFile(
        audioPath,
        transcriptionPath,
        tool.apiKey as string,
        openaiModel
      )
    } else if (provider === 'assemblyai_audio') {
      const tool = await ToolManager.initTool(AssemblyAIAudioTool)
      await tool.transcribeToFile(
        audioPath,
        transcriptionPath,
        tool.apiKey as string
      )
    } else if (provider === 'elevenlabs_audio') {
      const tool = await ToolManager.initTool(ElevenLabsAudioTool)
      await tool.transcribeToFile(
        audioPath,
        transcriptionPath,
        tool.apiKey as string,
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
    if (isMissingToolSettingsError(error)) {
      return
    }
    leon.answer({
      key: 'transcription_error',
      data: { error: (error as Error).message },
      core: {
        should_stop_skill: true
      }
    })
  }
}

import fs from 'node:fs'
import path from 'node:path'

import type { TranscriptionOutput } from '@tools/music_audio/transcription-schema'
import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { Network } from '@sdk/network'

// Hardcoded default settings for ElevenLabs audio tool
const ELEVENLABS_AUDIO_API_KEY: string | null = null
const ELEVENLABS_AUDIO_MODEL = 'scribe_v1'
const DEFAULT_SETTINGS: Record<string, unknown> = {
  ELEVENLABS_AUDIO_API_KEY,
  ELEVENLABS_AUDIO_MODEL
}
const REQUIRED_SETTINGS = ['ELEVENLABS_AUDIO_API_KEY']

interface ElevenLabsWord {
  text: string
  start: number
  end: number
  type: 'word' | 'spacing' | 'audio_event'
  speaker_id?: string
}

interface ElevenLabsTranscriptionResponse {
  language_code: string
  language_probability: number
  text: string
  words: ElevenLabsWord[]
}

interface ElevenLabsDubbingCreateResponse {
  dubbing_id: string
  expected_duration_sec: number
}

interface ElevenLabsDubbingStatusResponse {
  dubbing_id: string
  name: string
  status: 'dubbing' | 'dubbed' | 'failed'
  target_languages: string[]
  error?: string | null
  created_at?: string
  editable?: boolean | null
}

export default class ElevenLabsAudioTool extends Tool {
  private static readonly TOOLKIT = 'music_audio'
  private readonly config: ReturnType<typeof ToolkitConfig.load>
  readonly apiKey: string | null
  readonly model: string

  constructor() {
    super()
    this.config = ToolkitConfig.load(ElevenLabsAudioTool.TOOLKIT, this.toolName)

    const toolSettings = ToolkitConfig.loadToolSettings(
      ElevenLabsAudioTool.TOOLKIT,
      this.toolName,
      DEFAULT_SETTINGS
    )
    this.settings = toolSettings
    this.requiredSettings = REQUIRED_SETTINGS
    this.checkRequiredSettings(this.toolName)

    // Priority: toolkit settings > hardcoded default
    this.apiKey =
      (this.settings['ELEVENLABS_AUDIO_API_KEY'] as string) ||
      ELEVENLABS_AUDIO_API_KEY
    this.model =
      (this.settings['ELEVENLABS_AUDIO_MODEL'] as string) ||
      ELEVENLABS_AUDIO_MODEL
  }

  get toolName(): string {
    return 'elevenlabs_audio'
  }

  get toolkit(): string {
    return ElevenLabsAudioTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Transcribe audio to a file using ElevenLabs' Scribe v1 API
   * @param inputPath Path to the audio file to transcribe
   * @param outputPath Path to save the JSON transcription (unified format)
   * @param apiKey ElevenLabs API key (uses env/hardcoded default if not provided)
   * @param model Transcription model (defaults to tool default)
   * @param diarize Whether to enable speaker diarization (defaults to true)
   */
  async transcribeToFile(
    inputPath: string,
    outputPath: string,
    apiKey?: string,
    model?: string,
    diarize = true
  ): Promise<string> {
    // Use provided values, instance values, or error
    const finalApiKey = apiKey || this.apiKey
    const finalModel = model || this.model
    if (!finalApiKey) {
      throw new Error('ElevenLabs API key is missing')
    }

    const form = new FormData()
    const audioFile = await fs.openAsBlob(inputPath)
    form.append('file', audioFile, path.basename(inputPath))
    form.append('model_id', finalModel)
    form.append('diarize', diarize.toString())
    form.append('tag_audio_events', 'true')
    form.append('timestamps_granularity', 'word')

    const network = new Network({ baseURL: 'https://api.elevenlabs.io' })
    const response = await network.request<ElevenLabsTranscriptionResponse>({
      url: '/v1/speech-to-text',
      method: 'POST',
      data: form,
      headers: {
        'xi-api-key': finalApiKey
      }
    })

    const normalizedOutput: TranscriptionOutput = this.parseTranscription(
      response.data
    )

    await fs.promises.writeFile(
      outputPath,
      JSON.stringify(normalizedOutput, null, 2),
      'utf8'
    )

    return outputPath
  }

  /**
   * Create a dubbing project using ElevenLabs' Dubbing API
   * @param inputPath Path to the audio/video file to dub
   * @param targetLang Target language code (e.g., 'es', 'fr', 'zh')
   * @param apiKey ElevenLabs API key
   * @param sourceLang Source language code (defaults to 'auto')
   * @param numSpeakers Number of speakers (0 for auto-detect)
   * @param watermark Whether to add watermark to output video
   * @returns Dubbing project ID and expected duration
   */
  async createDubbing(
    inputPath: string,
    targetLang: string,
    apiKey: string,
    sourceLang = 'auto',
    numSpeakers = 0,
    watermark = false
  ): Promise<ElevenLabsDubbingCreateResponse> {
    if (!apiKey) {
      throw new Error('ElevenLabs API key is missing')
    }

    const form = new FormData()
    const mediaFile = await fs.openAsBlob(inputPath)
    form.append('file', mediaFile, path.basename(inputPath))
    form.append('target_lang', targetLang)
    form.append('source_lang', sourceLang)
    form.append('num_speakers', numSpeakers.toString())
    form.append('watermark', watermark.toString())

    const network = new Network({ baseURL: 'https://api.elevenlabs.io' })
    const response = await network.request<ElevenLabsDubbingCreateResponse>({
      url: '/v1/dubbing',
      method: 'POST',
      data: form,
      headers: {
        'xi-api-key': apiKey
      }
    })

    return response.data
  }

  /**
   * Get the status of a dubbing project
   * @param dubbingId The dubbing project ID
   * @param apiKey ElevenLabs API key
   * @returns Dubbing project status information
   */
  async getDubbingStatus(
    dubbingId: string,
    apiKey: string
  ): Promise<ElevenLabsDubbingStatusResponse> {
    if (!apiKey) {
      throw new Error('ElevenLabs API key is missing')
    }

    const network = new Network({ baseURL: 'https://api.elevenlabs.io' })
    const response = await network.request<ElevenLabsDubbingStatusResponse>({
      url: `/v1/dubbing/${dubbingId}`,
      method: 'GET',
      headers: {
        'xi-api-key': apiKey
      }
    })

    return response.data
  }

  /**
   * Download the dubbed file
   * @param dubbingId The dubbing project ID
   * @param targetLang Target language code
   * @param outputPath Path to save the dubbed file
   * @param apiKey ElevenLabs API key
   * @returns Path to the downloaded file
   */
  async downloadDubbedFile(
    dubbingId: string,
    targetLang: string,
    outputPath: string,
    apiKey: string
  ): Promise<string> {
    if (!apiKey) {
      throw new Error('ElevenLabs API key is missing')
    }

    const network = new Network({ baseURL: 'https://api.elevenlabs.io' })
    const response = await network.request({
      url: `/v1/dubbing/${dubbingId}/audio/${targetLang}`,
      method: 'GET',
      headers: {
        'xi-api-key': apiKey
      },
      responseType: 'arraybuffer'
    })

    // Write the audio/video file
    await fs.promises.writeFile(
      outputPath,
      Buffer.from(response.data as ArrayBuffer)
    )

    return outputPath
  }

  private parseTranscription(
    rawOutput: ElevenLabsTranscriptionResponse
  ): TranscriptionOutput {
    const wordItems = rawOutput.words.filter((item) => item.type === 'word')
    const uniqueSpeakers = Array.from(
      new Set(wordItems.map((word) => word.speaker_id).filter(Boolean))
    ) as string[]

    // Calculate duration from the last word's end time
    const duration =
      wordItems.length > 0 ? wordItems[wordItems.length - 1]?.end : 0
    const segments = wordItems.map((word) => ({
      from: word.start,
      to: word.end,
      text: word.text,
      speaker: word.speaker_id || null
    }))

    return {
      duration: duration ?? 0,
      speakers: uniqueSpeakers,
      speaker_count: uniqueSpeakers.length,
      segments,
      metadata: {
        tool: this.toolName
      }
    }
  }
}

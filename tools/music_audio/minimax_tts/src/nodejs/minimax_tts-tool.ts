import fs from 'node:fs'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { Network } from '@sdk/network'

// Hardcoded default settings for MiniMax TTS tool
const MINIMAX_TTS_API_KEY: string | null = null
const MINIMAX_TTS_MODEL = 'speech-2.8-hd'
const MINIMAX_TTS_REGION = 'global_en'
const DEFAULT_SETTINGS: Record<string, unknown> = {
  MINIMAX_TTS_API_KEY,
  MINIMAX_TTS_MODEL,
  MINIMAX_TTS_REGION
}
const REQUIRED_SETTINGS = ['MINIMAX_TTS_API_KEY']

/**
 * Text-to-audio endpoint per region. The global endpoint is served from the
 * international host, the Chinese one from the mainland host.
 */
const TEXT_TO_AUDIO_ENDPOINTS = {
  global_en: 'https://api.minimax.io/v1/t2a_v2',
  cn_zh: 'https://api.minimaxi.com/v1/t2a_v2'
} as const

/** Speech models accepted by the text-to-audio endpoint. */
const SUPPORTED_MODELS = [
  'speech-2.8-hd',
  'speech-2.8-turbo',
  'speech-2.6-hd',
  'speech-2.6-turbo',
  'speech-02-hd',
  'speech-02-turbo',
  'speech-01-hd',
  'speech-01-turbo'
] as const

/** Audio container formats the endpoint can encode. */
const SUPPORTED_AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'pcm'] as const

/** The endpoint reports success with this status code. */
const SUCCESS_STATUS_CODE = 0

export type SupportedRegion = keyof typeof TEXT_TO_AUDIO_ENDPOINTS
export type SupportedModel = (typeof SUPPORTED_MODELS)[number]
export type SupportedAudioFormat = (typeof SUPPORTED_AUDIO_FORMATS)[number]

/** Encoding of the audio payload returned by the endpoint. */
export type OutputFormat = 'hex' | 'url'

export interface AudioSetting extends Record<string, unknown> {
  format?: SupportedAudioFormat
}

export interface SynthesizeOptions {
  /** Speech model to synthesize with. Defaults to the configured model. */
  model?: string
  /** Regional endpoint to call. Defaults to the configured region. */
  region?: string
  /** API key overriding the configured one. */
  apiKey?: string
  /** Encoding of the returned audio. Defaults to hex. */
  outputFormat?: OutputFormat
  /** Language or dialect to prioritize during synthesis. */
  languageBoost?: string
  /** Whether the endpoint should also generate subtitles. */
  subtitleEnable?: boolean
  /** Voice options. A voice_id is required by the endpoint. */
  voiceSetting?: Record<string, unknown>
  /** Output audio options such as format, sample rate and bitrate. */
  audioSetting?: AudioSetting
  /** Pronunciation replacement rules applied to the text. */
  pronunciationDict?: Record<string, unknown>
  /** Voice modification options such as pitch, intensity and timbre. */
  voiceModify?: Record<string, unknown>
}

interface TextToAudioRequest extends Record<string, unknown> {
  model: string
  text: string
  stream: boolean
  output_format: OutputFormat
}

interface TextToAudioResponse {
  data?: {
    audio?: string
    status?: number
  } | null
  base_resp?: {
    status_code?: number
    status_msg?: string
  } | null
}

export default class MiniMaxTTSTool extends Tool {
  private static readonly TOOLKIT = 'music_audio'
  private readonly config: ReturnType<typeof ToolkitConfig.load>
  readonly apiKey: string | null
  readonly model: string
  readonly region: string

  constructor() {
    super()
    this.config = ToolkitConfig.load(MiniMaxTTSTool.TOOLKIT, this.toolName)

    const toolSettings = ToolkitConfig.loadToolSettings(
      MiniMaxTTSTool.TOOLKIT,
      this.toolName,
      DEFAULT_SETTINGS
    )
    this.settings = toolSettings
    this.requiredSettings = REQUIRED_SETTINGS
    this.checkRequiredSettings(this.toolName)

    // Priority: toolkit settings > hardcoded default
    this.apiKey =
      (this.settings['MINIMAX_TTS_API_KEY'] as string) || MINIMAX_TTS_API_KEY
    this.model =
      (this.settings['MINIMAX_TTS_MODEL'] as string) || MINIMAX_TTS_MODEL
    this.region =
      (this.settings['MINIMAX_TTS_REGION'] as string) || MINIMAX_TTS_REGION
  }

  get toolName(): string {
    return 'minimax_tts'
  }

  get toolkit(): string {
    return MiniMaxTTSTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Synthesize speech from text and save the generated audio to a file
   * @param text Text to synthesize into speech
   * @param outputPath Path of the audio file to write
   * @param options Optional synthesis settings, defaulting to the tool settings
   * @returns The path to the generated audio file
   */
  async synthesizeToFile(
    text: string,
    outputPath: string,
    options: SynthesizeOptions = {}
  ): Promise<string> {
    if (!text) {
      throw new Error('Text to synthesize is missing')
    }
    if (!outputPath) {
      throw new Error('Output path is missing')
    }

    const apiKey = options.apiKey || this.apiKey
    if (!apiKey) {
      throw new Error('MiniMax API key is missing')
    }

    const model = options.model || this.model
    if (!this.isSupportedModel(model)) {
      throw new Error(
        `Unsupported speech model "${model}". Supported models: ${SUPPORTED_MODELS.join(
          ', '
        )}`
      )
    }

    const region = options.region || this.region
    if (!this.isSupportedRegion(region)) {
      throw new Error(
        `Unsupported region "${region}". Supported regions: ${Object.keys(
          TEXT_TO_AUDIO_ENDPOINTS
        ).join(', ')}`
      )
    }

    const audioFormat = options.audioSetting?.format
    if (audioFormat && !this.isSupportedAudioFormat(audioFormat)) {
      throw new Error(
        `Unsupported audio format "${audioFormat}". Supported formats: ${SUPPORTED_AUDIO_FORMATS.join(
          ', '
        )}`
      )
    }

    const outputFormat: OutputFormat = options.outputFormat || 'hex'
    const endpoint = new URL(TEXT_TO_AUDIO_ENDPOINTS[region])
    const network = new Network({ baseURL: endpoint.origin })
    const response = await network.request<TextToAudioResponse>({
      url: endpoint.pathname,
      method: 'POST',
      data: this.buildRequest(text, model, outputFormat, options),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    const statusCode = response.data.base_resp?.status_code
    if (statusCode !== undefined && statusCode !== SUCCESS_STATUS_CODE) {
      const statusMessage =
        response.data.base_resp?.status_msg || 'Unknown error'

      throw new Error(
        `MiniMax speech synthesis failed with status ${statusCode}: ${statusMessage}`
      )
    }

    const audio = response.data.data?.audio
    if (!audio) {
      throw new Error('MiniMax speech synthesis returned no audio')
    }

    const audioBuffer =
      outputFormat === 'url'
        ? await this.downloadAudio(audio)
        : this.decodeAudio(audio)

    await fs.promises.writeFile(outputPath, audioBuffer)

    return outputPath
  }

  /** Build the request body, omitting the options that were not provided. */
  private buildRequest(
    text: string,
    model: string,
    outputFormat: OutputFormat,
    options: SynthesizeOptions
  ): TextToAudioRequest {
    const request: TextToAudioRequest = {
      model,
      text,
      // The whole audio is needed at once to write it to a file
      stream: false,
      output_format: outputFormat
    }

    if (options.languageBoost) {
      request['language_boost'] = options.languageBoost
    }
    if (options.subtitleEnable !== undefined) {
      request['subtitle_enable'] = options.subtitleEnable
    }
    if (options.voiceSetting) {
      request['voice_setting'] = options.voiceSetting
    }
    if (options.audioSetting) {
      request['audio_setting'] = options.audioSetting
    }
    if (options.pronunciationDict) {
      request['pronunciation_dict'] = options.pronunciationDict
    }
    if (options.voiceModify) {
      request['voice_modify'] = options.voiceModify
    }

    return request
  }

  /** Decode the hexadecimal audio payload returned by the endpoint. */
  private decodeAudio(audio: string): Buffer {
    if (audio.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(audio)) {
      throw new Error('MiniMax speech synthesis returned a malformed audio')
    }

    return Buffer.from(audio, 'hex')
  }

  /** Download the audio when the endpoint returns a URL instead of bytes. */
  private async downloadAudio(audioURL: string): Promise<Buffer> {
    const url = new URL(audioURL)
    const network = new Network({ baseURL: url.origin })
    const response = await network.request({
      url: `${url.pathname}${url.search}`,
      method: 'GET',
      responseType: 'arraybuffer'
    })

    return Buffer.from(response.data as ArrayBuffer)
  }

  private isSupportedModel(model: string): model is SupportedModel {
    return SUPPORTED_MODELS.includes(model as SupportedModel)
  }

  private isSupportedRegion(region: string): region is SupportedRegion {
    return Object.prototype.hasOwnProperty.call(
      TEXT_TO_AUDIO_ENDPOINTS,
      region
    )
  }

  private isSupportedAudioFormat(
    audioFormat: string
  ): audioFormat is SupportedAudioFormat {
    return SUPPORTED_AUDIO_FORMATS.includes(
      audioFormat as SupportedAudioFormat
    )
  }
}

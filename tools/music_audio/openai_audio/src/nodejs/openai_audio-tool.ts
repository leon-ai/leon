import fs from 'node:fs'
import path from 'node:path'

import type { TranscriptionOutput } from '@tools/music_audio/transcription-schema'
import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { Network } from '@sdk/network'

// Hardcoded default settings for OpenAI audio tool
const OPENAI_AUDIO_API_KEY: string | null = null
const OPENAI_AUDIO_MODEL = 'whisper-1'
const DEFAULT_SETTINGS: Record<string, unknown> = {
  OPENAI_AUDIO_API_KEY,
  OPENAI_AUDIO_MODEL
}
const REQUIRED_SETTINGS = ['OPENAI_AUDIO_API_KEY']

interface OpenAITranscriptionOutput {
  task: string
  duration: number
  text: string
  segments: {
    type: string
    id: string
    start: number
    end: number
    text: string
    speaker: string
  }[]
  usage: {
    type: string
    seconds: number
  }
}

export default class OpenAIAudioTool extends Tool {
  private static readonly TOOLKIT = 'music_audio'
  private readonly config: ReturnType<typeof ToolkitConfig.load>
  readonly apiKey: string | null
  readonly model: string

  constructor() {
    super()
    this.config = ToolkitConfig.load(OpenAIAudioTool.TOOLKIT, this.toolName)

    const toolSettings = ToolkitConfig.loadToolSettings(
      OpenAIAudioTool.TOOLKIT,
      this.toolName,
      DEFAULT_SETTINGS
    )
    this.settings = toolSettings
    this.requiredSettings = REQUIRED_SETTINGS
    this.checkRequiredSettings(this.toolName)

    // Priority: toolkit settings > hardcoded default
    this.apiKey =
      (this.settings['OPENAI_AUDIO_API_KEY'] as string) || OPENAI_AUDIO_API_KEY
    this.model =
      (this.settings['OPENAI_AUDIO_MODEL'] as string) || OPENAI_AUDIO_MODEL
  }

  get toolName(): string {
    // Use the actual config name for toolkit lookup
    return 'openai_audio'
  }

  get toolkit(): string {
    return OpenAIAudioTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Transcribe audio to a file using OpenAI's audio transcription API via SDK Network
   * @param inputPath Path to the audio file to transcribe
   * @param outputPath Path to save the plain text transcription
   * @param apiKey OpenAI API key (uses env/hardcoded default if not provided)
   * @param model Transcription model (defaults to tool default)
   */
  async transcribeToFile(
    inputPath: string,
    outputPath: string,
    apiKey?: string,
    model?: string
  ): Promise<string> {
    // Use provided values, instance values, or error
    const finalApiKey = apiKey || this.apiKey
    const finalModel = model || this.model
    if (!finalApiKey) {
      throw new Error('OpenAI API key is missing')
    }

    const form = new FormData()
    const audioFile = await fs.openAsBlob(inputPath)
    form.append('file', audioFile, path.basename(inputPath))
    form.append('model', finalModel)
    form.append('chunking_strategy', 'auto')
    form.append('response_format', 'diarized_json')

    const network = new Network({ baseURL: 'https://api.openai.com' })
    const response = await network.request({
      url: '/v1/audio/transcriptions',
      method: 'POST',
      data: form,
      headers: {
        Authorization: `Bearer ${finalApiKey}`
      }
    })

    const parsedOutput = this.parseTranscription(
      response.data as OpenAITranscriptionOutput
    )

    await fs.promises.writeFile(
      outputPath,
      JSON.stringify(parsedOutput, null, 2),
      'utf8'
    )

    return outputPath
  }

  private parseTranscription(
    rawOutput: OpenAITranscriptionOutput
  ): TranscriptionOutput {
    const speakers = Array.from(
      new Set(rawOutput.segments.map((segment) => segment.speaker))
    )

    const segments = rawOutput.segments.map((segment) => {
      return {
        from: segment.start,
        to: segment.end,
        text: segment.text,
        speaker: segment.speaker || null
      }
    })

    // If duration is not found, use the "to" property from the last segment
    let duration = rawOutput.duration
    if (!duration && segments.length > 0) {
      duration = segments[segments.length - 1]?.to || 0
    }

    return {
      duration: duration || 0,
      speakers: speakers,
      speaker_count: speakers.length,
      segments,
      metadata: {
        tool: this.toolName
      }
    }
  }
}

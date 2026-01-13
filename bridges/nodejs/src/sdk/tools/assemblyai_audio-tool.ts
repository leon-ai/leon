import fs from 'node:fs'

import type { TranscriptionOutput } from '@sdk/tools/schemas'
import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { Network } from '@sdk/network'

interface AssemblyAIUploadResponse {
  upload_url: string
}

interface AssemblyAITranscriptionResponse {
  id: string
  status: 'queued' | 'processing' | 'completed' | 'error'
  text: string
  words?: {
    text: string
    start: number
    end: number
    confidence: number
    speaker?: string
  }[]
  utterances?: {
    text: string
    start: number
    end: number
    confidence: number
    speaker: string
    words: {
      text: string
      start: number
      end: number
      confidence: number
    }[]
  }[]
  audio_duration?: number
  error?: string
}

export default class AssemblyAIAudioTool extends Tool {
  private static readonly TOOLKIT = 'music_audio'
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    this.config = ToolkitConfig.load(AssemblyAIAudioTool.TOOLKIT, this.toolName)
  }

  get toolName(): string {
    return 'assemblyai_audio'
  }

  get toolkit(): string {
    return AssemblyAIAudioTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Transcribe audio to a file using AssemblyAI's audio transcription API via SDK Network
   * @param inputPath Path to the audio file to transcribe
   * @param outputPath Path to save the JSON transcription
   * @param apiKey AssemblyAI API key
   * @param speakerLabels Enable speaker diarization (default: true)
   */
  async transcribeToFile(
    inputPath: string,
    outputPath: string,
    apiKey: string,
    speakerLabels = true
  ): Promise<string> {
    if (!apiKey) {
      throw new Error('AssemblyAI API key is missing')
    }

    const network = new Network({ baseURL: 'https://api.assemblyai.com' })

    // Step 1: Upload the audio file
    const audioData = await fs.promises.readFile(inputPath)
    const uploadResponse = await network.request({
      url: '/v2/upload',
      method: 'POST',
      data: audioData,
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/octet-stream'
      }
    })

    const uploadUrl = (uploadResponse.data as AssemblyAIUploadResponse)
      .upload_url

    // Step 2: Submit transcription request
    const transcriptionResponse = await network.request({
      url: '/v2/transcript',
      method: 'POST',
      data: {
        audio_url: uploadUrl,
        speaker_labels: speakerLabels
      },
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json'
      }
    })

    const transcriptId = (
      transcriptionResponse.data as AssemblyAITranscriptionResponse
    ).id

    // Step 3: Poll for completion
    let transcriptData: AssemblyAITranscriptionResponse
    let attempts = 0
    const maxAttempts = 180 // 15 minutes with 5 second intervals

    while (attempts < maxAttempts) {
      const statusResponse = await network.request({
        url: `/v2/transcript/${transcriptId}`,
        method: 'GET',
        headers: {
          Authorization: apiKey
        }
      })

      transcriptData = statusResponse.data as AssemblyAITranscriptionResponse

      if (transcriptData.status === 'completed') {
        break
      } else if (transcriptData.status === 'error') {
        throw new Error(
          `AssemblyAI transcription failed: ${
            transcriptData.error || 'Unknown error'
          }`
        )
      }

      // Wait 5 seconds before polling again
      await new Promise((resolve) => setTimeout(resolve, 5000))
      attempts++
    }

    if (attempts >= maxAttempts) {
      throw new Error('AssemblyAI transcription timed out')
    }

    // Step 4: Parse and save the transcription
    const parsedOutput = this.parseTranscription(transcriptData!)

    await fs.promises.writeFile(
      outputPath,
      JSON.stringify(parsedOutput, null, 2),
      'utf8'
    )

    return outputPath
  }

  private parseTranscription(
    rawOutput: AssemblyAITranscriptionResponse
  ): TranscriptionOutput {
    const segments: {
      from: number
      to: number
      text: string
      speaker: string | null
    }[] = []
    const speakers: Set<string> = new Set()

    // Use utterances for speaker-labeled segments if available
    if (rawOutput.utterances && rawOutput.utterances.length > 0) {
      for (const utterance of rawOutput.utterances) {
        segments.push({
          from: utterance.start / 1_000, // Convert milliseconds to seconds
          to: utterance.end / 1_000,
          text: utterance.text,
          speaker: utterance.speaker
        })
        speakers.add(utterance.speaker)
      }
    } else if (rawOutput.words && rawOutput.words.length > 0) {
      // Fallback to word-level data if utterances are not available
      // Group consecutive words by speaker (if available)
      let currentSegment: {
        from: number
        to: number
        text: string
        speaker: string | null
      } | null = null

      for (const word of rawOutput.words) {
        const speaker = word.speaker || null

        if (
          currentSegment &&
          currentSegment.speaker === speaker &&
          word.start / 1_000 - currentSegment.to < 1.0 // Max 1 second gap
        ) {
          // Extend current segment
          currentSegment.to = word.end / 1_000
          currentSegment.text += ` ${word.text}`
        } else {
          // Start a new segment
          if (currentSegment) {
            segments.push(currentSegment)
          }
          currentSegment = {
            from: word.start / 1_000,
            to: word.end / 1_000,
            text: word.text,
            speaker: speaker
          }
        }

        if (speaker) {
          speakers.add(speaker)
        }
      }

      // Push the last segment
      if (currentSegment) {
        segments.push(currentSegment)
      }
    } else {
      // Fallback: create a single segment with the full text
      segments.push({
        from: 0,
        to: (rawOutput.audio_duration || 0) / 1_000,
        text: rawOutput.text,
        speaker: null
      })
    }

    // Calculate duration
    let duration = rawOutput.audio_duration ? rawOutput.audio_duration : 0
    if (!duration && segments.length > 0) {
      duration = segments[segments.length - 1]?.to || 0
    }

    return {
      duration,
      speakers: Array.from(speakers),
      speaker_count: speakers.size,
      segments,
      metadata: {
        tool: this.toolName
      }
    }
  }
}

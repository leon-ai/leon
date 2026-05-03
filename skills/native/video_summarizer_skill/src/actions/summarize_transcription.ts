import fs from 'node:fs'

import type { ActionFunction, ActionParams } from '@sdk/types'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import { Settings } from '@sdk/settings'
import ToolManager, { isMissingToolSettingsError } from '@sdk/tool-manager'
import OpenRouterTool from '@tools/communication/openrouter'
import type { TranscriptionOutput } from '@tools/music_audio/transcription-schema'

interface VideoSummarizerSettings extends Record<string, unknown> {
  openrouter_model?: string | null
  summary_temperature?: number
  summary_max_tokens?: number
  summary_key_points_limit?: number
  summary_new_knowledge_limit?: number
  summary_max_transcript_chars?: number
}

const buildTranscriptText = (
  segments: TranscriptionOutput['segments']
): string => {
  return segments
    .map((segment) => segment.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const truncateTranscript = (
  transcript: string,
  maxChars: number
): { text: string, truncated: boolean } => {
  if (transcript.length <= maxChars) {
    return { text: transcript, truncated: false }
  }

  const headSize = Math.floor(maxChars * 0.7)
  const tailSize = Math.max(maxChars - headSize - 5, 0)
  const head = transcript.slice(0, headSize).trim()
  const tail = transcript.slice(-tailSize).trim()
  const combined = tail ? `${head} ... ${tail}` : head
  return { text: combined, truncated: true }
}

export const run: ActionFunction = async function (
  _params: ActionParams,
  paramsHelper: ParamsHelper
) {
  try {
    const transcriptionPath =
      (paramsHelper.getActionArgument('transcription_path') as
        | string
        | undefined) ||
      paramsHelper.getContextData<string>('transcription_path')
    const summaryLanguage =
      paramsHelper.getContextData<string>('summary_language')

    if (!transcriptionPath || !fs.existsSync(transcriptionPath)) {
      leon.answer({ key: 'transcription_not_found' })
      return
    }

    let transcription: TranscriptionOutput

    try {
      const rawContent = await fs.promises.readFile(transcriptionPath, 'utf8')
      transcription = JSON.parse(rawContent) as TranscriptionOutput
    } catch (error) {
      leon.answer({
        key: 'summary_error',
        data: { error: (error as Error).message },
        core: {
          should_stop_skill: true
        }
      })
      return
    }

    const segments = transcription.segments || []
    if (segments.length === 0) {
      leon.answer({ key: 'no_segments_found' })
      return
    }

    const rawTranscript = buildTranscriptText(segments)
    if (!rawTranscript) {
      leon.answer({ key: 'no_segments_found' })
      return
    }

    const settings = new Settings<VideoSummarizerSettings>()
    const openrouterModel = (await settings.get('openrouter_model')) as
      | string
      | null
      | undefined
    const temperature =
      ((await settings.get('summary_temperature')) as number | undefined) ?? 0.3
    const maxTokens =
      ((await settings.get('summary_max_tokens')) as number | undefined) ?? 900
    const keyPointsLimit =
      ((await settings.get('summary_key_points_limit')) as
        | number
        | undefined) ?? 6
    const newKnowledgeLimit =
      ((await settings.get('summary_new_knowledge_limit')) as
        | number
        | undefined) ?? 4
    const maxTranscriptChars =
      ((await settings.get('summary_max_transcript_chars')) as
        | number
        | undefined) ?? 12_000

    const { text: transcriptText, truncated } = truncateTranscript(
      rawTranscript,
      maxTranscriptChars
    )

    const openrouterTool = await ToolManager.initTool(OpenRouterTool)

    const languageInstruction = summaryLanguage
      ? `Write the summary in ${summaryLanguage}.`
      : 'Write the summary in the same language as the transcript.'

    const prompt = `Summarize the following transcript into key points and new knowledge.
${languageInstruction}
Provide up to ${keyPointsLimit} key points and up to ${newKnowledgeLimit} new knowledge items.
Each item must be concise and factual. Avoid filler or repetition.

Transcript:
${transcriptText}`

    leon.answer({
      key: 'summary_started',
      data: {
        segment_count: segments.length,
        model: openrouterModel || 'default'
      }
    })

    const requestOptions = {
      prompt,
      temperature,
      max_tokens: maxTokens,
      json_schema: {
        name: 'video_summary',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            key_points: {
              type: 'array',
              items: { type: 'string' }
            },
            new_knowledge: {
              type: 'array',
              items: { type: 'string' }
            }
          },
          required: ['key_points', 'new_knowledge']
        }
      }
    }

    const response = await openrouterTool.structuredCompletion(
      openrouterModel
        ? { ...requestOptions, model: openrouterModel }
        : requestOptions
    )

    if (!response.success) {
      leon.answer({
        key: 'summary_error',
        data: { error: response.error || 'Unknown error' }
      })
      return
    }

    const summaryData = response.data as {
      key_points?: string[]
      new_knowledge?: string[]
    }

    const keyPoints = (summaryData.key_points || [])
      .map((item) => item.trim())
      .filter(Boolean)
    const newKnowledge = (summaryData.new_knowledge || [])
      .map((item) => item.trim())
      .filter(Boolean)

    if (keyPoints.length === 0 && newKnowledge.length === 0) {
      leon.answer({ key: 'summary_empty' })
      return
    }

    const keyPointsText = keyPoints.map((item) => `- ${item}`).join('\n')
    const newKnowledgeText = newKnowledge.map((item) => `- ${item}`).join('\n')

    leon.answer({
      key: 'summary_completed',
      data: {
        key_points: keyPointsText || '- (none)',
        new_knowledge: newKnowledgeText || '- (none)',
        transcript_truncated: truncated ? 1 : 0
      }
    })
  } catch (error: unknown) {
    if (isMissingToolSettingsError(error)) {
      return
    }
    throw error
  }
}

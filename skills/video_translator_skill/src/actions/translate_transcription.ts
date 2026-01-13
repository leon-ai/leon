import fs from 'node:fs'
import path from 'node:path'

import type { ActionFunction, ActionParams } from '@sdk/types'
import type { TranscriptionOutput } from '@sdk/tools/schemas'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import { Settings } from '@sdk/settings'
import OpenRouterTool from '@sdk/tools/openrouter-tool'
import { formatFilePath } from '@sdk/utils'

interface VideoTranslatorSkillSettings extends Record<string, unknown> {
  openrouter_api_key?: string
  openrouter_model?: string
  translation_max_tokens_per_request?: number
  translation_segments_per_batch?: number
}

const DEFAULT_TRANSLATION_SYSTEM_PROMPT = `You are a professional translator specializing in video/audio content translation.

Your task is to translate transcription segments while:
1. Preserving the natural speaking style and tone
2. Maintaining context across all segments (this is a continuous conversation/narration)
3. Keeping translations concise to match the original speech duration when possible
4. Adapting idioms and cultural references appropriately
5. Maintaining speaker consistency if multiple speakers are present

Translate ONLY the text content. Do not add explanations, notes, or any other text.`

export const run: ActionFunction = async function (
  _params: ActionParams,
  paramsHelper: ParamsHelper
) {
  const transcriptionPathArg =
    paramsHelper.getActionArgument('transcription_path') ||
    (paramsHelper.findActionArgumentFromContext('transcription_path') as string)
  const targetLanguage =
    (paramsHelper.getActionArgument('target_language') as string) ||
    paramsHelper.getContextData<string>('target_language')

  try {
    const settings = new Settings<VideoTranslatorSkillSettings>()
    const openrouterApiKey = (await settings.get(
      'translation_openrouter_api_key'
    )) as string | undefined
    const openrouterModel = ((await settings.get(
      'translation_openrouter_model'
    )) || 'gemini-2.5-flash') as string
    const maxTokens = ((await settings.get(
      'translation_max_tokens_per_request'
    )) || 2_000) as number
    const segmentsPerBatch = ((await settings.get(
      'translation_segments_per_batch'
    )) || 10) as number

    const transcriptionPath =
      transcriptionPathArg || paramsHelper.getContextData('transcription_path')

    if (!transcriptionPath || !fs.existsSync(transcriptionPath)) {
      leon.answer({
        key: 'transcription_not_found'
      })
      return
    }

    if (!targetLanguage) {
      leon.answer({
        key: 'target_language_missing'
      })
      return
    }

    if (!openrouterApiKey) {
      leon.answer({
        key: 'missing_api_key'
      })
      return
    }

    // Read and parse the transcription file
    const transcriptionContent = await fs.promises.readFile(
      transcriptionPath,
      'utf-8'
    )
    const transcription: TranscriptionOutput = JSON.parse(transcriptionContent)

    if (!transcription.segments || transcription.segments.length === 0) {
      leon.answer({
        key: 'no_segments_found'
      })
      return
    }

    leon.answer({
      key: 'translation_started',
      data: {
        transcription_path: formatFilePath(transcriptionPath),
        target_language: targetLanguage,
        segment_count: transcription.segments.length.toString(),
        model: openrouterModel
      }
    })

    // Initialize OpenRouter tool
    const tool = new OpenRouterTool(openrouterApiKey)

    // Prepare translated segments array
    const translatedSegments = [...transcription.segments]

    // Process segments in batches
    const totalBatches = Math.ceil(
      transcription.segments.length / segmentsPerBatch
    )

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
      const startIdx = batchIndex * segmentsPerBatch
      const endIdx = Math.min(
        startIdx + segmentsPerBatch,
        transcription.segments.length
      )
      const batchSegments = transcription.segments.slice(startIdx, endIdx)

      // Build context-aware prompt
      const segmentTexts = batchSegments
        .map(
          (segment, idx) =>
            `[Segment ${startIdx + idx + 1}] ${segment.text.trim()}`
        )
        .join('\n')

      const userPrompt = `Translate the following ${batchSegments.length} segments into ${targetLanguage}.

Original segments:
${segmentTexts}

Provide ONLY the translated text for each segment, one per line, in the same order. Format each line as:
[Segment X] <translated text>

Do not include any explanations or additional text.`

      leon.answer({
        key: 'translating_batch',
        data: {
          batch_number: (batchIndex + 1).toString(),
          total_batches: totalBatches.toString(),
          segments_in_batch: batchSegments.length.toString()
        }
      })

      // Call OpenRouter for translation
      const response = await tool.completion({
        prompt: userPrompt,
        model: openrouterModel,
        temperature: 0.2, // Lower temperature for more consistent translations
        max_tokens: maxTokens,
        system_prompt: DEFAULT_TRANSLATION_SYSTEM_PROMPT
      })

      if (!response.success) {
        leon.answer({
          key: 'translation_api_error',
          data: {
            error: response.error || 'Unknown error',
            batch_number: (batchIndex + 1).toString()
          }
        })
        return
      }

      // Parse the translated segments
      const translatedText = response.data.content.trim()
      const translatedLines = translatedText
        .split('\n')
        .filter((line: string) => line.trim())

      // Extract translations and update segments
      for (let i = 0; i < batchSegments.length; i += 1) {
        const globalIdx = startIdx + i
        const segmentPattern = new RegExp(
          `\\[Segment ${globalIdx + 1}\\]\\s*(.+)`,
          'i'
        )

        // Try to find the matching translated line
        let translatedContent = ''
        for (const line of translatedLines) {
          const match = line.match(segmentPattern)
          if (match && match[1]) {
            translatedContent = match[1].trim()
            break
          }
        }

        // Fallback: if pattern matching fails, use the line by index
        if (!translatedContent && translatedLines[i]) {
          translatedContent = translatedLines[i]
            .replace(/^\[Segment \d+\]\s*/, '')
            .trim()
        }

        if (translatedContent) {
          translatedSegments[globalIdx] = {
            ...translatedSegments[globalIdx],
            text: translatedContent
          }
        }
      }

      // Small delay between batches to avoid rate limiting
      if (batchIndex < totalBatches - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }

    // Create translated transcription object
    const translatedTranscription: TranscriptionOutput = {
      ...transcription,
      segments: translatedSegments,
      metadata: {
        ...transcription.metadata
      }
    }

    // Write translated transcription to a new file
    const transcriptionDir = path.dirname(transcriptionPath)
    const transcriptionName = path.parse(transcriptionPath).name
    const translatedPath = path.join(
      transcriptionDir,
      `${transcriptionName}_${targetLanguage
        .toLowerCase()
        .replace(/\s+/g, '_')}.json`
    )

    await fs.promises.writeFile(
      translatedPath,
      JSON.stringify(translatedTranscription, null, 2),
      'utf-8'
    )

    leon.answer({
      key: 'translation_completed',
      data: {
        translated_path: formatFilePath(translatedPath),
        target_language: targetLanguage,
        segment_count: translatedSegments.length.toString()
      },
      core: {
        context_data: {
          translated_transcription_path: translatedPath,
          target_language: targetLanguage
        }
      }
    })
  } catch (error) {
    leon.answer({
      key: 'translation_error',
      data: { error: (error as Error).message }
    })
  }
}

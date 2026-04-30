import fs from 'node:fs'
import path from 'node:path'

import type { ActionFunction, ActionParams } from '@sdk/types'
import type { TranscriptionOutput } from '@tools/music_audio/transcription-schema'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import { Settings } from '@sdk/settings'
import ToolManager, { isMissingToolSettingsError } from '@sdk/tool-manager'
import ChatterboxONNXTool from '@tools/music_audio/chatterbox_onnx'
import Qwen3TTSTool, {
  type SupportedLanguage
} from '@tools/music_audio/qwen3_tts'
import FfmpegTool from '@tools/video_streaming/ffmpeg'
import FfprobeTool from '@tools/video_streaming/ffprobe'
import { formatFilePath, normalizeLanguageCode } from '@sdk/utils'

interface SpeakerReference {
  speaker: string
  reference1_path: string
  reference2_path: string
}

interface Segment {
  from: number
  to: number
  text: string
  speaker: string
}

interface ProcessedSegment {
  path: string
  start: number
}

interface VideoTranslatorSkillSettings extends Record<string, unknown> {
  speech_synthesis_provider?: 'qwen3_tts' | 'chatterbox_onnx'
  translation_openrouter_model?: string
  translation_max_tokens_per_request?: number
  translation_segments_per_batch?: number
}

const BREAK_CHARS = ',.!?'
const GROUP_TARGET_CHARS = 272
const LONG_PAUSE_S = 1.5
const MAX_SPEED_UP_RATIO = 1.3

function getLanguageDisplayName(languageCode: string): string {
  try {
    return (
      new Intl.DisplayNames(['en'], { type: 'language' }).of(languageCode) ||
      languageCode
    )
  } catch {
    return languageCode
  }
}

/**
 * Convert seconds to milliseconds
 */
function toMs(seconds: number): number {
  return Math.round(seconds * 1_000)
}

/**
 * Split a segment's text into smaller chunks at natural breakpoints
 * Respects GROUP_TARGET_CHARS limit and breaks at punctuation when possible
 */
function splitSegmentText(
  segment: Segment,
  maxChars: number
): Array<{ text: string, ratio: number }> {
  const text = segment.text.trim()
  if (text.length <= maxChars) {
    return [{ text, ratio: 1.0 }]
  }

  const chunks: Array<{ text: string, ratio: number }> = []
  let remaining = text
  const totalLength = text.length

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push({
        text: remaining,
        ratio: remaining.length / totalLength
      })
      break
    }

    // Find the best break point within maxChars
    let breakPoint = maxChars
    const searchText = remaining.substring(0, maxChars + 1)

    // Look for punctuation followed by space (natural break)
    const punctuationPattern = /[.!?,;:]\s/g
    let lastMatch = -1
    let match

    while ((match = punctuationPattern.exec(searchText)) !== null) {
      lastMatch = match.index + 1 // +1 to include the punctuation
    }

    if (lastMatch > maxChars * 0.5) {
      // Found good punctuation break in the latter half
      breakPoint = lastMatch
    } else {
      // Look for last space in the limit
      const lastSpace = searchText.lastIndexOf(' ', maxChars)
      if (lastSpace > maxChars * 0.3) {
        // Found a space in acceptable range
        breakPoint = lastSpace
      }
    }

    const chunk = remaining.substring(0, breakPoint).trim()
    chunks.push({
      text: chunk,
      ratio: chunk.length / totalLength
    })
    remaining = remaining.substring(breakPoint).trim()
  }

  return chunks
}

/**
 * Create natural phrases (clauses) from segments
 * Also splits long segments into smaller chunks
 */
function createPhrases(segments: Segment[]): Segment[] {
  const phrases: Segment[] = []
  let currentPhrase: Segment | null = null

  for (const segment of segments) {
    const text = segment.text.trim()
    const speakerId = segment.speaker

    if (!text || !speakerId) continue

    // If segment is too long, split it first
    if (text.length > GROUP_TARGET_CHARS) {
      // Push any current phrase first
      if (currentPhrase) {
        phrases.push(currentPhrase)
        currentPhrase = null
      }

      // Split the long segment
      const chunks = splitSegmentText(segment, GROUP_TARGET_CHARS)
      const segmentDuration = segment.to - segment.from

      let accumulatedRatio = 0
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i]
        if (!chunk) continue

        const chunkStartTime = segment.from + segmentDuration * accumulatedRatio
        const chunkEndTime =
          segment.from + segmentDuration * (accumulatedRatio + chunk.ratio)

        phrases.push({
          from: chunkStartTime,
          to: chunkEndTime,
          text: chunk.text,
          speaker: speakerId
        })

        accumulatedRatio += chunk.ratio
      }

      continue
    }

    // Normal phrase building logic
    if (currentPhrase === null || currentPhrase.speaker !== speakerId) {
      if (currentPhrase) phrases.push(currentPhrase)
      currentPhrase = { ...segment, text }
    } else {
      currentPhrase.text = `${currentPhrase.text} ${text}`
      currentPhrase.to = segment.to
    }

    if (BREAK_CHARS.split('').some((char) => text.endsWith(char))) {
      phrases.push(currentPhrase)
      currentPhrase = null
    }
  }

  if (currentPhrase) phrases.push(currentPhrase)

  return phrases
}

/**
 * Group phrases into larger, efficient segments
 * Ensures no group exceeds GROUP_TARGET_CHARS
 */
function groupPhrases(phrases: Segment[]): Segment[] {
  const groups: Segment[] = []
  let currentGroup: Segment | null = null

  for (const phrase of phrases) {
    // If phrase itself is too long, split it into the current group
    if (phrase.text.length > GROUP_TARGET_CHARS) {
      // If we have a current group, push it first
      if (currentGroup) {
        groups.push(currentGroup)
        currentGroup = null
      }
      // Push the long phrase as its own group (no choice)
      groups.push({ ...phrase })
      continue
    }

    if (currentGroup === null) {
      currentGroup = { ...phrase }
    } else {
      const pauseDuration = phrase.from - currentGroup.to
      const combinedLength = currentGroup.text.length + 1 + phrase.text.length // +1 for space

      // Break conditions: speaker changes, adding phrase would exceed limit, or there's a long pause
      if (
        currentGroup.speaker !== phrase.speaker ||
        combinedLength > GROUP_TARGET_CHARS ||
        pauseDuration >= LONG_PAUSE_S
      ) {
        groups.push(currentGroup)
        currentGroup = { ...phrase }
      } else {
        currentGroup.text = `${currentGroup.text} ${phrase.text}`
        currentGroup.to = phrase.to
      }
    }
  }

  if (currentGroup) groups.push(currentGroup)

  return groups
}

export const run: ActionFunction = async function (
  _params: ActionParams,
  paramsHelper: ParamsHelper
) {
  const translatedTranscriptionPath =
    (paramsHelper.getActionArgument(
      'translated_transcription_path'
    ) as string) ||
    paramsHelper.getContextData<string>('translated_transcription_path')
  const audioPath =
    (paramsHelper.getActionArgument('audio_path') as string) ||
    paramsHelper.getContextData<string>('audio_path')
  const speakerReferences =
    (paramsHelper.getActionArgument('speaker_references') as
      | SpeakerReference[]
      | undefined) ||
    paramsHelper.getContextData<SpeakerReference[]>('speaker_references')
  const targetLanguageInput =
    (paramsHelper.getActionArgument('target_language') as string) ||
    paramsHelper.getContextData<string>('target_language_code') ||
    paramsHelper.getContextData<string>('target_language')
  const targetLanguageCode = paramsHelper.getContextData<string>(
    'target_language_code'
  )
  const targetLanguage =
    targetLanguageCode || (targetLanguageInput
      ? normalizeLanguageCode(targetLanguageInput)
      : null)
  const targetLanguageLabel =
    paramsHelper.getContextData<string>('target_language') ||
    (targetLanguage ? getLanguageDisplayName(targetLanguage) : targetLanguageInput)

  try {
    // Load settings
    const settings = new Settings<VideoTranslatorSkillSettings>()
    const provider = ((await settings.get('speech_synthesis_provider')) ||
      'qwen3_tts') as NonNullable<
      VideoTranslatorSkillSettings['speech_synthesis_provider']
    >

    // Validate inputs
    if (
      !translatedTranscriptionPath ||
      !fs.existsSync(translatedTranscriptionPath)
    ) {
      leon.answer({
        key: 'translated_transcription_not_found'
      })
      return
    }

    if (!audioPath || !fs.existsSync(audioPath)) {
      leon.answer({
        key: 'audio_not_found'
      })
      return
    }

    if (!speakerReferences || speakerReferences.length === 0) {
      leon.answer({
        key: 'speaker_references_missing'
      })
      return
    }

    if (!targetLanguage) {
      leon.answer({
        key: 'target_language_missing',
        data: {
          note:
            'The target language is missing or could not be mapped to a supported language code.'
        }
      })
      return
    }

    const resolvedTargetLanguageLabel =
      targetLanguageLabel || getLanguageDisplayName(targetLanguage)

    // Read and parse transcription
    const transcriptionContent = await fs.promises.readFile(
      translatedTranscriptionPath,
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
      key: 'synthesis_started',
      data: {
        segment_count: transcription.segments.length.toString(),
        speaker_count: speakerReferences.length.toString(),
        target_language: resolvedTargetLanguageLabel,
        provider
      }
    })

    // Initialize tools
    const ffmpegTool = await ToolManager.initTool(FfmpegTool)
    const ffprobeTool = await ToolManager.initTool(FfprobeTool)

    // Prepare output directory
    const audioDir = path.dirname(audioPath)
    const processedSegmentsDir = path.join(audioDir, 'processed_segments')
    await fs.promises.mkdir(processedSegmentsDir, { recursive: true })

    // Create phrases and groups
    leon.answer({
      key: 'grouping_segments'
    })

    const phrases = createPhrases(
      transcription.segments as unknown as Segment[]
    )
    const groups = groupPhrases(phrases)

    leon.answer({
      key: 'segments_grouped',
      data: {
        original_count: transcription.segments.length.toString(),
        grouped_count: groups.length.toString()
      }
    })

    // Build speaker reference map
    const speakerRefMap = new Map<string, SpeakerReference>()
    for (const ref of speakerReferences) {
      speakerRefMap.set(ref.speaker, ref)
    }

    // Prepare synthesis tasks for batch processing
    interface GroupTask {
      index: number
      group: Segment
      rawAudioPath: string
      startTimeMs: number
      endTimeMs: number
      originalDurationMs: number
    }

    const synthesisTasks: Array<{
      text: string
      target_language: string
      audio_path: string
      speaker_reference_path: string
      exaggeration: number
      cfg_strength: number
      temperature: number
      auto_split: boolean
    }> = []
    const validGroupTasks: GroupTask[] = []

    leon.answer({
      key: 'preparing_synthesis_tasks',
      data: {
        total_groups: groups.length.toString()
      }
    })

    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i]
      if (!group) continue

      const textToSpeak = group.text.trim()
      const speakerId = group.speaker

      if (!textToSpeak) continue

      const speakerRef = speakerRefMap.get(speakerId)
      if (!speakerRef) {
        leon.answer({
          key: 'speaker_reference_not_found',
          data: {
            speaker: speakerId
          }
        })
        continue
      }

      const rawAudioPath = path.join(
        processedSegmentsDir,
        `segment_${i}_raw.wav`
      )

      const startTimeMs = toMs(group.from)
      const endTimeMs = toMs(group.to)
      const originalDurationMs = endTimeMs - startTimeMs

      validGroupTasks.push({
        index: i,
        group,
        rawAudioPath,
        startTimeMs,
        endTimeMs,
        originalDurationMs
      })

      synthesisTasks.push({
        text: textToSpeak,
        target_language: targetLanguage,
        audio_path: rawAudioPath,
        speaker_reference_path: speakerRef.reference1_path,
        exaggeration: 0.4,
        cfg_strength: 0.1,
        temperature: 0.5,
        auto_split: false // Video translator handles its own grouping logic
      })
    }

    // Batch synthesize all audio segments at once
    if (synthesisTasks.length > 0) {
      leon.answer({
        key: 'batch_synthesis_started',
        data: {
          task_count: synthesisTasks.length.toString(),
          provider
        }
      })

      try {
        if (provider === 'qwen3_tts') {
          const qwen3TTSTool = await ToolManager.initTool(Qwen3TTSTool)
          const qwenTasks = synthesisTasks.map((task) => ({
            text: task.text,
            target_language: resolvedTargetLanguageLabel as SupportedLanguage,
            audio_path: task.audio_path,
            speaker_reference_path: task.speaker_reference_path,
            x_vector_only_mode: true
          }))

          await qwen3TTSTool.synthesizeSpeech(qwenTasks)
        } else if (provider === 'chatterbox_onnx') {
          const chatterboxTool = await ToolManager.initTool(ChatterboxONNXTool)
          // Note: auto_split is disabled for video translator, so processedTasks === synthesisTasks
          await chatterboxTool.synthesizeSpeechToFiles(synthesisTasks)
        } else {
          throw new Error(`Unsupported speech synthesis provider: ${provider}`)
        }

        leon.answer({
          key: 'batch_synthesis_completed',
          data: {
            task_count: synthesisTasks.length.toString()
          }
        })
      } catch (error) {
        leon.answer({
          key: 'batch_synthesis_failed',
          data: {
            error: (error as Error).message
          },
          core: {
            should_stop_skill: true
          }
        })
        throw error
      }
    }

    // Post-process each generated audio file
    const processedFiles: ProcessedSegment[] = []

    leon.answer({
      key: 'post_processing_started',
      data: {
        segment_count: validGroupTasks.length.toString()
      }
    })

    for (const task of validGroupTasks) {
      const { index, rawAudioPath, startTimeMs, originalDurationMs } = task

      // Verify the audio file was created
      if (!fs.existsSync(rawAudioPath)) {
        leon.answer({
          key: 'segment_not_generated',
          data: {
            segment_number: (index + 1).toString()
          }
        })
        continue
      }

      // Get the actual generated audio duration using ffprobe for accuracy
      let generatedDurationMs: number
      try {
        generatedDurationMs = await ffprobeTool.getDuration(rawAudioPath)
      } catch {
        // Fallback to file size estimation if ffprobe fails
        const generatedStats = await fs.promises.stat(rawAudioPath)
        generatedDurationMs = Math.max(
          (generatedStats.size / 44_100) * 1_000,
          100
        )
      }

      const finalSegmentPath = path.join(
        processedSegmentsDir,
        `segment_${index}_final.wav`
      )

      // Synchronization logic
      if (originalDurationMs <= 0 || generatedDurationMs <= 0) {
        // Can't sync, just copy
        await fs.promises.copyFile(rawAudioPath, finalSegmentPath)
      } else {
        const durationRatio = generatedDurationMs / originalDurationMs

        if (durationRatio <= 1.0) {
          // Generated audio is shorter, pad with silence
          // For now, just copy the file (padding will be done in assembly)
          await fs.promises.copyFile(rawAudioPath, finalSegmentPath)
        } else {
          // Generated audio is longer, speed it up
          const speedFactor = Math.min(durationRatio, MAX_SPEED_UP_RATIO)

          if (speedFactor < durationRatio) {
            leon.answer({
              key: 'capping_speed',
              data: {
                segment_number: (index + 1).toString(),
                requested_speed: durationRatio.toFixed(2),
                capped_speed: speedFactor.toFixed(2)
              }
            })
          }

          try {
            // Create temp file for tempo-adjusted audio
            const tempAdjustedPath = path.join(
              processedSegmentsDir,
              `segment_${index}_adjusted.wav`
            )

            await ffmpegTool.adjustTempo(
              rawAudioPath,
              tempAdjustedPath,
              speedFactor
            )

            // Trim to exact original duration to ensure precise timing
            const startTime = '00:00:00.000'
            const endTime = new Date(originalDurationMs)
              .toISOString()
              .substr(11, 12)

            await ffmpegTool.trimMedia(
              tempAdjustedPath,
              finalSegmentPath,
              startTime,
              endTime
            )

            // Clean up temp file
            await fs.promises.unlink(tempAdjustedPath).catch(() => {
              /* ignore */
            })
          } catch (error) {
            leon.answer({
              key: 'tempo_adjustment_failed',
              data: {
                group_number: (index + 1).toString(),
                error: (error as Error).message
              },
              core: {
                should_stop_skill: true
              }
            })
            // Fallback: use original
            await fs.promises.copyFile(rawAudioPath, finalSegmentPath)
          }
        }
      }

      processedFiles.push({
        path: finalSegmentPath,
        start: startTimeMs
      })

      // Clean up raw file
      await fs.promises.unlink(rawAudioPath).catch(() => {
        /* ignore */
      })
    }

    leon.answer({
      key: 'assembling_audio'
    })

    // Assemble final audio track with precise timing
    const originalTotalDurationMs = toMs(transcription.duration)

    // Create output path for final dubbed audio
    const audioName = path.parse(audioPath).name
    const finalAudioPath = path.join(
      audioDir,
      `${audioName}_dubbed_${targetLanguage
        .toLowerCase()
        .replace(/\s+/g, '_')}.wav`
    )

    try {
      // Use FFmpeg to assemble segments with precise timing (like pydub overlay)
      await ffmpegTool.assembleAudioSegments(
        processedFiles.map((seg) => ({
          path: seg.path,
          startMs: seg.start
        })),
        finalAudioPath,
        originalTotalDurationMs
      )

      leon.answer({
        key: 'audio_assembly_completed',
        data: {
          output_path: formatFilePath(finalAudioPath)
        }
      })
    } catch (assemblyError) {
      leon.answer({
        key: 'audio_assembly_failed',
        data: {
          error: (assemblyError as Error).message
        },
        core: {
          should_stop_skill: true
        }
      })
      throw assemblyError
    }

    // Also create a manifest file for reference
    const manifestPath = path.join(audioDir, 'segments_manifest.json')
    await fs.promises.writeFile(
      manifestPath,
      JSON.stringify(
        {
          original_duration_ms: originalTotalDurationMs,
          target_language: targetLanguage,
          segments: processedFiles.map((seg, idx) => ({
            index: idx,
            path: seg.path,
            start_ms: seg.start
          }))
        },
        null,
        2
      ),
      'utf-8'
    )

    leon.answer({
      key: 'synthesis_completed',
      data: {
        processed_count: processedFiles.length.toString(),
        output_path: formatFilePath(finalAudioPath),
        output_folder: formatFilePath(processedSegmentsDir),
        manifest_path: formatFilePath(manifestPath),
        target_language: resolvedTargetLanguageLabel
      },
      core: {
        context_data: {
          processed_segments_dir: processedSegmentsDir,
          segments_manifest_path: manifestPath,
          dubbed_audio_path: finalAudioPath,
          target_language: resolvedTargetLanguageLabel,
          target_language_code: targetLanguage
        }
      }
    })
  } catch (error) {
    if (isMissingToolSettingsError(error)) {
      return
    }
    leon.answer({
      key: 'synthesis_error',
      data: {
        error: (error as Error).message
      },
      core: {
        should_stop_skill: true
      }
    })
  }
}

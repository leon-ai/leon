import fs from 'node:fs'
import path from 'node:path'

import type { ActionFunction, ActionParams } from '@sdk/types'
import type { TranscriptionOutput } from '@sdk/tools/schemas'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import FfmpegTool from '@sdk/tools/ffmpeg-tool'
import { formatFilePath } from '@sdk/utils'

interface SpeakerReference {
  speaker: string
  reference1_path: string
  reference2_path: string
}

/**
 * Format seconds to HH:MM:SS format for ffmpeg
 */
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const secs = Math.floor(seconds % 60)

  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

export const run: ActionFunction = async function (
  _params: ActionParams,
  paramsHelper: ParamsHelper
) {
  // Get transcription path and audio path from arguments or context
  const transcriptionPath =
    (paramsHelper.getActionArgument('transcription_path') as string) ||
    paramsHelper.getContextData<string>('transcription_path')
  const audioPath =
    (paramsHelper.getActionArgument('audio_path') as string) ||
    paramsHelper.getContextData<string>('audio_path')

  try {
    // Validate inputs
    if (!transcriptionPath || !fs.existsSync(transcriptionPath)) {
      leon.answer({
        key: 'transcription_not_found'
      })
      return
    }

    if (!audioPath || !fs.existsSync(audioPath)) {
      leon.answer({
        key: 'audio_not_found'
      })
      return
    }

    // Read and parse transcription
    const transcriptionContent = await fs.promises.readFile(
      transcriptionPath,
      'utf-8'
    )
    const transcription: TranscriptionOutput = JSON.parse(transcriptionContent)

    // Validate transcription has segments and speakers
    if (
      !transcription.segments ||
      transcription.segments.length === 0 ||
      !transcription.speakers ||
      transcription.speakers.length === 0
    ) {
      leon.answer({
        key: 'no_speakers_found'
      })
      return
    }

    leon.answer({
      key: 'extraction_started',
      data: {
        speaker_count: transcription.speaker_count.toString(),
        audio_path: formatFilePath(audioPath)
      }
    })

    // Calculate the threshold: start from after the first third
    const firstThirdEnd = transcription.duration / 3

    // Initialize ffmpeg tool
    const ffmpegTool = new FfmpegTool()

    // Prepare output directory
    const audioDir = path.dirname(audioPath)
    const speakerReferences: SpeakerReference[] = []

    // Process each speaker
    for (const speaker of transcription.speakers) {
      // Segments after first third
      let speakerSegments = transcription.segments.filter(
        (segment) =>
          segment.speaker === speaker && segment.from >= firstThirdEnd
      )
      let fallback = false
      if (speakerSegments.length === 0) {
        // No segments after first third for this speaker, try all available for fallback
        speakerSegments = transcription.segments.filter(
          (segment) => segment.speaker === speaker
        )
        fallback = true
      }
      if (speakerSegments.length === 0) {
        leon.answer({
          key: 'no_valid_segments',
          data: {
            speaker
          }
        })
        continue
      }

      // Try to find a 10+ second segment first
      let reference1Segment = findBestSegment(speakerSegments, 10, null)

      // If couldn't find 10+ seconds, try fallback (all segments)
      if (!reference1Segment && !fallback) {
        speakerSegments = transcription.segments.filter(
          (segment) => segment.speaker === speaker
        )
        reference1Segment = findBestSegment(speakerSegments, 10, null)
      }

      // If still can't find 10+ seconds, find the longest single segment
      if (!reference1Segment) {
        reference1Segment = findLongestSegment(speakerSegments)
      }

      if (!reference1Segment) {
        leon.answer({
          key: 'insufficient_audio',
          data: {
            speaker
          }
        })

        continue
      }

      // Reuse the same segment for reference 2
      const reference2Segment = reference1Segment

      // Create output paths for speaker references
      const reference1Path = path.join(
        audioDir,
        `speaker_${speaker}_reference_1.mp3`
      )
      const reference2Path = path.join(
        audioDir,
        `speaker_${speaker}_reference_2.mp3`
      )

      // Extract first reference
      const ref1StartTime = formatTime(reference1Segment.start)
      const ref1EndTime = formatTime(reference1Segment.end)
      const ref1Duration = (
        reference1Segment.end - reference1Segment.start
      ).toFixed(1)

      leon.answer({
        key: 'extracting_reference',
        data: {
          speaker,
          reference_number: '1',
          start_time: ref1StartTime,
          duration: ref1Duration
        }
      })

      await ffmpegTool.trimMedia(
        audioPath,
        reference1Path,
        ref1StartTime,
        ref1EndTime
      )

      // Extract second reference
      const ref2StartTime = formatTime(reference2Segment.start)
      const ref2EndTime = formatTime(reference2Segment.end)
      const ref2Duration = (
        reference2Segment.end - reference2Segment.start
      ).toFixed(1)

      leon.answer({
        key: 'extracting_reference',
        data: {
          speaker,
          reference_number: '2',
          start_time: ref2StartTime,
          duration: ref2Duration
        }
      })

      await ffmpegTool.trimMedia(
        audioPath,
        reference2Path,
        ref2StartTime,
        ref2EndTime
      )

      // Store speaker reference info
      speakerReferences.push({
        speaker,
        reference1_path: reference1Path,
        reference2_path: reference2Path
      })

      leon.answer({
        key: 'speaker_references_created',
        data: {
          speaker,
          reference1_path: formatFilePath(reference1Path),
          reference2_path: formatFilePath(reference2Path)
        }
      })
    }

    // Return success with all speaker references
    leon.answer({
      key: 'extraction_completed',
      data: {
        speaker_count: speakerReferences.length.toString(),
        folder_path: formatFilePath(audioDir)
      },
      core: {
        context_data: {
          speaker_references: speakerReferences
        }
      }
    })
  } catch (error) {
    leon.answer({
      key: 'extraction_error',
      data: {
        error: (error as Error).message
      }
    })
  }
}

/**
 * Find the closest segment(s) that can provide the required duration
 * Segments are already filtered to be after the first third and sorted by time
 * Combines consecutive segments if needed to reach required duration
 */
function findBestSegment(
  segments: Array<{ from: number; to: number }>,
  requiredDuration: number,
  excludeSegment: { start: number; end: number } | null
): { start: number; end: number } | null {
  // Segments are already sorted by time (from), find the earliest usable one
  for (let i = 0; i < segments.length; i += 1) {
    const currentSegment = segments[i]
    if (!currentSegment) continue

    const startTime = currentSegment.from
    let accumulatedDuration = currentSegment.to - currentSegment.from
    let endSegmentIndex = i

    // Check if we need to combine with following consecutive segments
    while (
      accumulatedDuration < requiredDuration &&
      endSegmentIndex + 1 < segments.length
    ) {
      const nextSegment = segments[endSegmentIndex + 1]
      if (!nextSegment) break

      const currentEnd = segments[endSegmentIndex]?.to
      if (!currentEnd) break

      // Check if next segment is consecutive (within 1 second gap)
      if (nextSegment.from - currentEnd > 1) {
        break
      }

      // Add next segment duration
      accumulatedDuration += nextSegment.to - nextSegment.from
      endSegmentIndex += 1
    }

    // If we have enough duration (or close enough)
    if (accumulatedDuration >= requiredDuration) {
      const endTime = startTime + requiredDuration

      // Check if this overlaps with the excluded segment
      if (excludeSegment) {
        const overlaps =
          (startTime >= excludeSegment.start &&
            startTime < excludeSegment.end) ||
          (endTime > excludeSegment.start && endTime <= excludeSegment.end) ||
          (startTime <= excludeSegment.start && endTime >= excludeSegment.end)

        if (overlaps) {
          // Skip this segment group and try the next one
          continue
        }
      }

      // Return the 10-second window starting from this point
      return { start: startTime, end: endTime }
    }
  }

  return null
}

/**
 * Find the longest single segment from the available segments
 */
function findLongestSegment(
  segments: Array<{ from: number; to: number }>
): { start: number; end: number } | null {
  if (segments.length === 0) {
    return null
  }

  let longestSegment = segments[0]
  let maxDuration = longestSegment.to - longestSegment.from

  for (let i = 1; i < segments.length; i += 1) {
    const segment = segments[i]
    if (!segment) {
      continue
    }

    const duration = segment.to - segment.from
    if (duration > maxDuration) {
      maxDuration = duration
      longestSegment = segment
    }
  }

  return longestSegment
    ? { start: longestSegment.from, end: longestSegment.to }
    : null
}

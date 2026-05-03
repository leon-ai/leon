import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import { Settings } from '@sdk/settings'
import ToolManager, { isMissingToolSettingsError } from '@sdk/tool-manager'
import GrokTool from '@tools/search_web/grok'
import OpenRouterTool from '@tools/communication/openrouter'
import ChatterboxONNXTool from '@tools/music_audio/chatterbox_onnx'
import FfmpegTool from '@tools/video_streaming/ffmpeg'
import FfprobeTool from '@tools/video_streaming/ffprobe'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'

interface PodcastSettings extends Record<string, unknown> {
  script_model?: string
  host_voice?: string
  guest_voice?: string
}

interface PodcastSegment {
  speaker: 'host' | 'guest'
  text: string
}

interface PodcastScript {
  title: string
  segments: PodcastSegment[]
}

export const run: ActionFunction = async function (
  _params,
  paramsHelper: ParamsHelper
) {
  const topic = paramsHelper.getActionArgument('topic') as string
  const durationParam = paramsHelper.getActionArgument('duration')
  const duration =
    typeof durationParam === 'number'
      ? durationParam
      : typeof durationParam === 'string'
        ? parseInt(durationParam, 10)
        : 5

  // Validate duration
  if (duration < 1 || duration > 30) {
    leon.answer({
      key: 'invalid_duration',
      data: { duration }
    })
    return
  }

  // Load settings
  const settings = new Settings<PodcastSettings>()
  const scriptModel =
    ((await settings.get('script_model')) as string) ||
    'google/gemini-3-flash-preview'
  const hostVoice =
    ((await settings.get('host_voice')) as string) || 'default_female'
  const guestVoice =
    ((await settings.get('guest_voice')) as string) || 'default_male'

  try {
    // Step 1: Research the topic using Grok
    leon.answer({
      key: 'researching',
      data: { topic }
    })

    const grok = await ToolManager.initTool(GrokTool)

    const researchResult = await grok.deepResearch(topic, [
      'Recent developments and trends',
      'Key facts and statistics',
      'Expert opinions',
      'Interesting angles and perspectives'
    ])

    if (!researchResult.success || !researchResult.data) {
      leon.answer({
        key: 'error',
        data: { error: researchResult.error || 'Research failed' }
      })
      return
    }

    // Responses API uses "output" array with the final text in content helper
    const researchContent = researchResult.content

    if (!researchContent) {
      leon.answer({
        key: 'error',
        data: { error: 'No research content found' }
      })
      return
    }

    // Step 2: Generate podcast script using OpenRouter with structured output
    leon.answer({ key: 'generating_script' })

    const openrouter = await ToolManager.initTool(OpenRouterTool)

    // Calculate approximate word count (150 words per minute of speech)
    const targetWordCount = duration * 150

    const scriptPrompt = `You are a podcast script writer. Based on the following research, create an engaging podcast conversation between a host and a guest expert.

RESEARCH CONTENT:
${researchContent}

REQUIREMENTS:
- Duration: approximately ${duration} minutes (${targetWordCount} words total)
- Create natural, conversational dialogue
- Host should ask insightful questions
- Guest should provide informative, engaging answers
- Include transitions, reactions, and natural speech patterns
- Make it educational but entertaining
- Alternate between host and guest naturally
- Keep each segment's text under 250 characters to avoid issues with text-to-speech synthesis

IMPORTANT: Generate valid JSON only. Do not include any explanations or markdown code blocks.

Generate the script as a JSON object with this structure:
{
  "title": "Episode title",
  "segments": [
    {"speaker": "host", "text": "Welcome to..."},
    {"speaker": "guest", "text": "Thanks for having me..."},
    ...
  ]
}`

    const scriptSchema = {
      name: 'podcast_script',
      schema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'The episode title'
          },
          segments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                speaker: {
                  type: 'string',
                  enum: ['host', 'guest'],
                  description: 'The speaker (host or guest)'
                },
                text: {
                  type: 'string',
                  description:
                    'What the speaker says (keep under 250 characters)',
                  maxLength: 250
                }
              },
              required: ['speaker', 'text'],
              additionalProperties: false
            }
          }
        },
        required: ['title', 'segments'],
        additionalProperties: false
      }
    }

    const scriptResult = await openrouter.structuredCompletion({
      prompt: scriptPrompt,
      json_schema: scriptSchema,
      model: scriptModel,
      temperature: 0.8,
      max_tokens: targetWordCount * 3 // Increased to prevent truncation
    })

    if (!scriptResult.success || !scriptResult.data) {
      leon.answer({
        key: 'error',
        data: { error: scriptResult.error || 'Script generation failed' }
      })
      return
    }

    const script = scriptResult.data as PodcastScript

    // Step 3: Synthesize audio using ChatterboxONNX (batch processing!)
    leon.answer({ key: 'synthesizing_audio' })

    const chatterbox = await ToolManager.initTool(ChatterboxONNXTool)

    // Create output directory
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'podcast_'))
    const finalAudioPath = path.join(
      outputDir,
      `${topic.replace(/[^a-z0-9]/gi, '_')}_podcast.wav`
    )

    // Prepare batch synthesis tasks (chatterbox automatically splits long text)
    const synthesisTasks: Array<{
      text: string
      audio_path: string
      voice_name: string
      temperature: number
    }> = []

    for (let i = 0; i < script.segments.length; i += 1) {
      const segment = script.segments[i]
      if (!segment) continue

      synthesisTasks.push({
        text: segment.text, // Chatterbox automatically splits if >272 chars
        audio_path: path.join(
          outputDir,
          `segment_${i.toString().padStart(4, '0')}.wav`
        ),
        voice_name: segment.speaker === 'host' ? hostVoice : guestVoice,
        temperature: 0.7
      })
    }

    // Batch synthesize all segments at once (EFFICIENT!)
    // Chatterbox automatically handles text splitting for long segments
    const processedTasks =
      await chatterbox.synthesizeSpeechToFiles(synthesisTasks)

    // Step 4: Merge all audio segments into final podcast
    const ffmpeg = await ToolManager.initTool(FfmpegTool)
    const ffprobe = await ToolManager.initTool(FfprobeTool)

    // Get all generated segment paths (including auto-split parts)
    const segmentPaths = processedTasks.map((task) => task.audio_path)

    // Calculate total duration by measuring each segment
    let totalDurationMs = 0
    const segmentsWithTiming: Array<{ path: string, startMs: number }> = []

    for (const segmentPath of segmentPaths) {
      const duration = await ffprobe.getDuration(segmentPath)
      segmentsWithTiming.push({
        path: segmentPath,
        startMs: totalDurationMs
      })
      totalDurationMs += duration + 500 // Add 500ms gap between speakers
    }

    // Merge segments with precise timing
    await ffmpeg.assembleAudioSegments(
      segmentsWithTiming,
      finalAudioPath,
      totalDurationMs
    )

    // Clean up individual segments
    for (const segmentPath of segmentPaths) {
      await fs.unlink(segmentPath).catch(() => {}) // Ignore errors
    }

    // Step 5: Return success
    leon.answer({
      key: 'success',
      data: {
        topic,
        duration,
        audio_file: finalAudioPath
      }
    })
  } catch (error: unknown) {
    if (isMissingToolSettingsError(error)) {
      return
    }
    leon.answer({
      key: 'error',
      data: { error: (error as Error).message },
      core: {
        should_stop_skill: true
      }
    })
  }
}

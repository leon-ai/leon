import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { ActionFunction } from '@sdk/types'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import ToolManager, { isMissingToolSettingsError } from '@sdk/tool-manager'
import Qwen3TtsTool from '@tools/music_audio/qwen3_tts'
import { formatFilePath } from '@sdk/utils'

function sanitizeFileName(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return sanitized || 'speech'
}

export const run: ActionFunction = async function (
  _params,
  paramsHelper: ParamsHelper
) {
  const voiceDescription = paramsHelper.getActionArgument(
    'voice_description'
  ) as string
  const speechText = paramsHelper.getActionArgument('speech_text') as string

  if (!voiceDescription) {
    leon.answer({ key: 'missing_voice_description' })
    return
  }

  if (!speechText) {
    leon.answer({ key: 'missing_speech_text' })
    return
  }

  const outputDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'voice_design_')
  )
  const outputPath = path.join(
    outputDir,
    `${sanitizeFileName(speechText.slice(0, 64))}.wav`
  )

  const tool = await ToolManager.initTool(Qwen3TtsTool)

  try {
    leon.answer({ key: 'designing_voice' })

    await tool.designVoice({
      text: speechText,
      instruct: voiceDescription,
      output_path: outputPath,
      audio_path: outputPath
    })

    let finalOutputPath = outputPath
    if (!fs.existsSync(outputPath)) {
      const outputs = await fs.promises.readdir(outputDir)
      const generatedFile = outputs.find((entry) =>
        entry.toLowerCase().endsWith('.wav')
      )

      if (!generatedFile) {
        leon.answer({
          key: 'output_not_found',
          data: { output_folder: formatFilePath(outputDir) }
        })
        return
      }

      finalOutputPath = path.join(outputDir, generatedFile)
    }

    leon.answer({
      key: 'success',
      data: {
        audio_path: formatFilePath(finalOutputPath)
      },
      core: {
        context_data: {
          audio_path: finalOutputPath
        }
      }
    })
  } catch (error) {
    if (isMissingToolSettingsError(error)) {
      return
    }
    leon.answer({
      key: 'error',
      data: {
        error: (error as Error).message
      },
      core: {
        should_stop_skill: true
      }
    })
  }
}

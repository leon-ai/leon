import fs from 'node:fs'
import path from 'node:path'

import type { ActionFunction, ActionParams } from '@sdk/types'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import UltimateVocalRemoverONNXTool from '@sdk/tools/ultimate_vocal_remover_onnx-tool'
import { formatFilePath } from '@sdk/utils'

export const run: ActionFunction = async function (
  _params: ActionParams,
  paramsHelper: ParamsHelper
) {
  const audioPathArg =
    paramsHelper.getActionArgument('audio_path') ||
    (paramsHelper.findActionArgumentFromContext('audio_path') as string)

  try {
    const audioPath = audioPathArg || paramsHelper.getContextData('audio_path')

    if (!audioPath || !fs.existsSync(audioPath)) {
      leon.answer({
        key: 'audio_not_found'
      })
      return
    }

    const audioDir = path.dirname(audioPath)
    const audioName = path.parse(audioPath).name
    const vocalPath = path.join(audioDir, `${audioName}_vocals.mp3`)
    const instrumentalPath = path.join(
      audioDir,
      `${audioName}_instrumental.mp3`
    )

    leon.answer({
      key: 'vocal_separation_started',
      data: {
        audio_path: formatFilePath(audioPath)
      }
    })

    const tool = new UltimateVocalRemoverONNXTool()
    await tool.separateVocals({
      audio_path: audioPath,
      vocal_output_path: vocalPath,
      instrumental_output_path: instrumentalPath,
      aggression: 1.3
    })

    if (!fs.existsSync(vocalPath) || !fs.existsSync(instrumentalPath)) {
      leon.answer({
        key: 'vocal_separation_error',
        data: { error: 'Vocal or instrumental file not found' }
      })
      return
    }

    leon.answer({
      key: 'vocal_separation_completed',
      data: {
        vocal_path: formatFilePath(vocalPath),
        instrumental_path: formatFilePath(instrumentalPath)
      },
      core: {
        context_data: {
          audio_path: vocalPath,
          vocal_path: vocalPath,
          instrumental_path: instrumentalPath
        }
      }
    })
  } catch (error) {
    leon.answer({
      key: 'vocal_separation_error',
      data: { error: (error as Error).message }
    })
  }
}

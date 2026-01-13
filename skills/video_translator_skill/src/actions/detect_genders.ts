import fs from 'node:fs'

import type { ActionFunction, ActionParams } from '@sdk/types'
import { leon } from '@sdk/leon'
import { ParamsHelper } from '@sdk/params-helper'
import ECAPATool from '@sdk/tools/ecapa-tool'

interface SpeakerReference {
  speaker: string
  reference1_path: string
  reference2_path: string
}

export const run: ActionFunction = async function (
  _params: ActionParams,
  paramsHelper: ParamsHelper
) {
  // Grab references from previous context
  const speakerReferences =
    paramsHelper.getContextData<SpeakerReference[]>('speaker_references')

  if (
    !speakerReferences ||
    !Array.isArray(speakerReferences) ||
    speakerReferences.length === 0
  ) {
    leon.answer({
      key: 'no_speaker_references',
      data: {
        message: 'No speaker references available to analyze gender.'
      }
    })

    return
  }

  const tool = new ECAPATool()
  const results: { speaker: string; gender: string }[] = []

  for (const ref of speakerReferences) {
    const clips = [ref.reference1_path, ref.reference2_path]
    let detected: string | undefined

    // Try both clips for reliability, stop at first confident one
    for (const clip of clips) {
      if (clip && fs.existsSync(clip)) {
        const gender = await tool.detectGender(clip)

        if (gender && gender !== 'unknown') {
          detected = gender
          break
        }

        // Save the result even if unknown, if no confident answer found
        if (!detected) {
          detected = gender
        }
      }
    }

    results.push({
      speaker: ref.speaker,
      gender: detected || 'unknown'
    })
  }

  leon.answer({
    key: 'genders_detected',
    data: {
      count: results.length,
      genders: JSON.stringify(results)
    },
    core: {
      context_data: {
        genders: results
      }
    }
  })
}

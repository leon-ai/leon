import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'

import type { LongLanguageCode } from '@/types'
import type { SynthesizeResult } from '@/core/tts/types'
import { LANG, TMP_PATH, BIN_PATH } from '@/constants'
import { TTS } from '@/core'
import { TTSSynthesizerBase } from '@/core/tts/tts-synthesizer-base'
import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'

const FLITE_CONFIG = {
  int_f0_target_mean: 115.0, // Intonation (85-180 Hz men; 165-255 Hz women)
  f0_shift: 1.0, // Low or high
  duration_stretch: 1.0, // Speed (lower = faster)
  int_f0_target_stddev: 15.0 // Pitch variability (lower = more flat)
}

export class FliteTTSSynthesizer extends TTSSynthesizerBase {
  protected readonly name = 'Flite TTS Synthesizer'
  protected readonly lang = LANG as LongLanguageCode
  private readonly binPath = path.join(BIN_PATH, 'flite', 'flite')

  constructor(lang: LongLanguageCode) {
    super()

    LogHelper.title(this.name)
    LogHelper.success('New instance')

    this.lang = lang

    if (this.lang !== 'en-US') {
      LogHelper.warning(
        'The Flite synthesizer only accepts the "en-US" language at the moment'
      )
    }

    if (!fs.existsSync(this.binPath)) {
      LogHelper.error(
        `Cannot find ${this.binPath} You can set up the offline TTS by running: "npm run setup:offline-tts"`
      )
    } else {
      LogHelper.success('Synthesizer initialized')
    }
  }

  public async synthesize(speech: string): Promise<SynthesizeResult | null> {
    const audioFilePath = path.join(
      TMP_PATH,
      `${Date.now()}-${StringHelper.random(4)}.wav`
    )
    const process = spawn(this.binPath, [
      speech,
      '--setf',
      `int_f0_target_mean=${FLITE_CONFIG.int_f0_target_mean}`,
      '--setf',
      `f0_shift=${FLITE_CONFIG.f0_shift}`,
      '--setf',
      `duration_stretch=${FLITE_CONFIG.duration_stretch}`,
      '--setf',
      `int_f0_target_stddev=${FLITE_CONFIG.int_f0_target_stddev}`,
      '-o',
      audioFilePath
    ])

    await new Promise((resolve, reject) => {
      process.stdout.on('end', resolve)
      process.stderr.on('data', reject)
    })

    const duration = await this.getAudioDuration(audioFilePath)

    TTS.em.emit('saved', duration)

    return {
      audioFilePath,
      duration
    }
  }
}

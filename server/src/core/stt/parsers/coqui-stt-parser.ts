import path from 'node:path'
import fs from 'node:fs'

import wav from 'node-wav'
import { Model } from 'stt'

import { STTParserBase } from '@/core/stt/stt-parser-base'
import { BIN_PATH } from '@/constants'
import { LogHelper } from '@/helpers/log-helper'

export default class CoquiSTTParser extends STTParserBase {
  protected readonly name = 'Coqui STT Parser'
  private readonly model: Model | undefined = undefined
  private readonly desiredSampleRate: number = 16_000

  constructor() {
    super()

    LogHelper.title(this.name)
    LogHelper.success('New instance')

    const modelPath = path.join(BIN_PATH, 'coqui', 'model.tflite')
    const scorerPath = path.join(BIN_PATH, 'coqui', 'huge-vocabulary.scorer')

    LogHelper.info(`Loading model from file ${modelPath}...`)

    if (!fs.existsSync(modelPath)) {
      LogHelper.error(
        `Cannot find ${modelPath}. You can set up the offline STT by running: "npm run setup:offline-stt"`
      )
    }

    if (!fs.existsSync(scorerPath)) {
      LogHelper.error(
        `Cannot find ${scorerPath}. You can setup the offline STT by running: "npm run setup:offline-stt"`
      )
    }

    try {
      this.model = new Model(modelPath)
    } catch (e) {
      throw Error(`${this.name} - Failed to load the model: ${e}`)
    }

    this.desiredSampleRate = this.model.sampleRate()

    try {
      this.model.enableExternalScorer(scorerPath)
    } catch (e) {
      throw Error(`${this.name} - Failed to enable external scorer: ${e}`)
    }

    LogHelper.success('Parser initialized')
  }

  /**
   * Read audio buffer and return the transcript (decoded string)
   */
  public async parse(buffer: Buffer): Promise<string | null> {
    const wavDecode = wav.decode(buffer)

    if (this.model) {
      if (wavDecode.sampleRate < this.desiredSampleRate) {
        LogHelper.warning(
          `Original sample rate (${wavDecode.sampleRate}) is lower than ${this.desiredSampleRate}Hz. Up-sampling might produce erratic speech recognition`
        )
      }

      // Decoded string
      return this.model.stt(buffer)
    }

    return null
  }
}

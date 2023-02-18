import path from 'node:path'

import type { SpeechClient } from '@google-cloud/speech'
import stt from '@google-cloud/speech'

import { STTParserBase } from '@/core/stt/stt-parser-base'
import { LANG, VOICE_CONFIG_PATH } from '@/constants'
import { LogHelper } from '@/helpers/log-helper'

export default class GoogleCloudSTTParser extends STTParserBase {
  protected readonly name = 'Google Cloud STT Parser'
  private readonly client: SpeechClient | undefined = undefined

  constructor() {
    super()

    LogHelper.title(this.name)
    LogHelper.success('New instance')

    /**
     * Initialize Google Cloud Speech-to-Text based on the credentials in the JSON file
     * the env variable "GOOGLE_APPLICATION_CREDENTIALS" provides the JSON file path
     */

    process.env['GOOGLE_APPLICATION_CREDENTIALS'] = path.join(
      VOICE_CONFIG_PATH,
      'google-cloud.json'
    )

    try {
      this.client = new stt.SpeechClient()

      LogHelper.success('Parser initialized')
    } catch (e) {
      LogHelper.error(`${this.name} - Failed to initialize: ${e}`)
    }
  }

  /**
   * Read audio buffer and return the transcript (decoded string)
   */
  public async parse(buffer: Buffer): Promise<string | null> {
    if (this.client) {
      const audioBytes = buffer.toString('base64')
      const audio = { content: audioBytes }

      try {
        const [res] = await this.client.recognize({
          audio,
          config: {
            languageCode: LANG,
            encoding: 'LINEAR16',
            sampleRateHertz: 16000
          }
        })

        // Decoded string
        return (res.results || [])
          .map((data) => data.alternatives && data.alternatives[0]?.transcript)
          .join('\n')
      } catch (e) {
        LogHelper.error(`${this.name} - Failed to parse: ${e}`)
      }
    } else {
      LogHelper.error(`${this.name} - Not initialized`)
    }

    return null
  }
}

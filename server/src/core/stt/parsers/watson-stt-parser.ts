import path from 'node:path'
import fs from 'node:fs'
import { Duplex } from 'node:stream'

import Stt from 'ibm-watson/speech-to-text/v1'
import { IamAuthenticator } from 'ibm-watson/auth'

import type { WatsonVoiceConfiguration } from '@/schemas/voice-config-schemas'
import { STTParserBase } from '@/core/stt/stt-parser-base'
import { LANG, VOICE_CONFIG_PATH } from '@/constants'
import { LogHelper } from '@/helpers/log-helper'

export default class WatsonSTTParser extends STTParserBase {
  protected readonly name = 'Watson STT Parser'
  private readonly client: Stt | undefined = undefined

  constructor() {
    super()

    LogHelper.title(this.name)
    LogHelper.success('New instance')

    const config: WatsonVoiceConfiguration = JSON.parse(
      fs.readFileSync(path.join(VOICE_CONFIG_PATH, 'watson-stt.json'), 'utf8')
    )

    try {
      this.client = new Stt({
        authenticator: new IamAuthenticator({ apikey: config.apikey }),
        serviceUrl: config.url
      })

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
      const stream = new Duplex()

      stream.push(buffer)
      stream.push(null)

      try {
        const { result } = await this.client.recognize({
          contentType: 'audio/wav',
          model: `${LANG}_BroadbandModel`,
          audio: stream
        })

        // Decoded string
        return (result.results || [])
          .map((data) => data.alternatives && data.alternatives[0]?.transcript)
          .join('\n')
      } catch (e) {
        LogHelper.error(`${this.name} - Failed to parse: ${e}`)
      }
    }

    return null
  }
}

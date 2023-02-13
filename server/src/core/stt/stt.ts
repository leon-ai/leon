import fs from 'node:fs'
import path from 'node:path'

import type { ASRAudioFormat } from '@/core/asr/types'
import type { STTParser } from '@/core/stt/types'
import { STT_PROVIDER, VOICE_CONFIG_PATH } from '@/constants'
import { SOCKET_SERVER, ASR } from '@/core'
import { STTParserNames, STTProviders } from '@/core/stt/types'
import { LogHelper } from '@/helpers/log-helper'

const PROVIDERS_MAP = {
  [STTProviders.GoogleCloudSTT]: STTParserNames.GoogleCloudSTT,
  [STTProviders.WatsonSTT]: STTParserNames.WatsonSTT,
  [STTProviders.CoquiSTT]: STTParserNames.CoquiSTT
}

export default class STT {
  private static instance: STT

  private parser: STTParser = undefined

  constructor() {
    if (!STT.instance) {
      LogHelper.title('STT')
      LogHelper.success('New instance')

      STT.instance = this
    }
  }

  public get isParserReady(): boolean {
    return !!this.parser
  }

  /**
   * Initialize the STT provider
   */
  public async init(): Promise<boolean> {
    LogHelper.info('Initializing STT...')

    if (!Object.values(STTProviders).includes(STT_PROVIDER as STTProviders)) {
      LogHelper.error(
        `The STT provider "${STT_PROVIDER}" does not exist or is not yet supported`
      )

      return false
    }

    if (
      STT_PROVIDER === STTProviders.GoogleCloudSTT &&
      typeof process.env['GOOGLE_APPLICATION_CREDENTIALS'] === 'undefined'
    ) {
      process.env['GOOGLE_APPLICATION_CREDENTIALS'] = path.join(
        VOICE_CONFIG_PATH,
        'google-cloud.json'
      )
    } else if (
      typeof process.env['GOOGLE_APPLICATION_CREDENTIALS'] !== 'undefined' &&
      process.env['GOOGLE_APPLICATION_CREDENTIALS'].indexOf(
        'google-cloud.json'
      ) === -1
    ) {
      LogHelper.warning(
        `The "GOOGLE_APPLICATION_CREDENTIALS" env variable is already settled with the following value: "${process.env['GOOGLE_APPLICATION_CREDENTIALS']}"`
      )
    }

    // Dynamically attribute the parser
    const { default: parser } = await import(
      path.join(
        __dirname,
        'parsers',
        PROVIDERS_MAP[STT_PROVIDER as STTProviders]
      )
    )
    this.parser = new parser() as STTParser

    LogHelper.title('STT')
    LogHelper.success('STT initialized')

    return true
  }

  /**
   * Read the speech file and transcribe
   */
  public async transcribe(audioFilePath: string): Promise<boolean> {
    LogHelper.info('Parsing WAVE file...')

    if (!fs.existsSync(audioFilePath)) {
      LogHelper.error(`The WAVE file "${audioFilePath}" does not exist`)

      return false
    }

    const buffer = fs.readFileSync(audioFilePath)
    const transcript = await this.parser?.parse(buffer)

    if (transcript && transcript !== '') {
      // Forward the string to the client
      this.forward(transcript)
    } else {
      this.deleteAudios()
    }

    return true
  }

  /**
   * Forward string output to the client
   * and delete audio files once it has been forwarded
   */
  private forward(str: string): void {
    SOCKET_SERVER.socket.emit('recognized', str, (confirmation: string) => {
      if (confirmation === 'string-received') {
        this.deleteAudios()
      }
    })

    LogHelper.success(`Parsing result: ${str}`)
  }

  /**
   * Delete audio files
   */
  private deleteAudios(): void {
    const audioPaths = Object.keys(ASR.audioPaths)

    for (let i = 0; i < audioPaths.length; i += 1) {
      const audioType = audioPaths[i] as ASRAudioFormat
      const audioPath = ASR.audioPaths[audioType]

      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath)
      }
    }
  }
}

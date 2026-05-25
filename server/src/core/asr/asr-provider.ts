import fs from 'node:fs'
import path from 'node:path'

import type { ASRAudioFormat, ASRParser } from '@/core/asr/types'
import { SERVER_CORE_PATH, ASR_PROVIDER } from '@/constants'
import { SOCKET_SERVER, ASR } from '@/core'
import { ASRParserNames, ASRProviders } from '@/core/asr/types'
import { LogHelper } from '@/helpers/log-helper'
import { FileHelper } from '@/helpers/file-helper'

const PROVIDERS_MAP = {
  [ASRProviders.Local]: ASRParserNames.Local
 //  [ASRProviders.GoogleCloudASR]: ASRParserNames.GoogleCloudASR,
  // [ASRProviders.WatsonASR]: ASRParserNames.WatsonASR,
  // [ASRProviders.CoquiASR]: ASRParserNames.CoquiASR
}

export default class ASRProvider {
  private static instance: ASRProvider

  private _parser: ASRParser = undefined

  constructor() {
    if (!ASRProvider.instance) {
      LogHelper.title('ASR')
      LogHelper.success('New instance')

      ASRProvider.instance = this
    }
  }

  public get parser(): ASRParser {
    return this._parser
  }

  public get isParserReady(): boolean {
    return !!this._parser
  }

  /**
   * Initialize the ASR provider.
   */
  public async init(): Promise<boolean> {
    LogHelper.title('ASR')
    LogHelper.info('Initializing ASR...')

    if (!Object.values(ASRProviders).includes(ASR_PROVIDER as ASRProviders)) {
      LogHelper.error(
        `The ASR provider "${ASR_PROVIDER}" does not exist or is not yet supported`
      )

      return false
    }

    /*if (
      ASR_PROVIDER === ASRProviders.GoogleCloudASR &&
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
    }*/

    try {
      // Dynamically attribute the parser
      const { default: parser } = await FileHelper.dynamicImportFromFile(
        path.join(
          SERVER_CORE_PATH,
          'asr',
          'parsers',
          `${PROVIDERS_MAP[ASR_PROVIDER as ASRProviders]}.js`
        )
      )
      this._parser = new parser() as ASRParser

      LogHelper.title('ASR')
      LogHelper.success('ASR initialized')

      return true
    } catch (e) {
      LogHelper.error(`The ASR provider failed to initialize: ${e}`)
      process.exit(1)
    }
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
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const transcript = await this._parser?.parse(buffer)

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
    SOCKET_SERVER.socket?.emit('recognized', str, (confirmation: string) => {
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

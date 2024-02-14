import fs from 'node:fs'

import { LLM_MINIMUM_FREE_RAM, LLM_PATH } from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import { SystemHelper } from '@/helpers/system-helper'

/**
 * Duties:
 *
 * Custom NER
 * Summarization
 * Translation
 * More accurate NLU (per domain list vs per skill list) / Utterance shortener or paraphraser
 * Knowledge base / RAG
 * Question answering
 * Sentiment analysis
 * Chit chat
 * Intent fallback
 */

export default class LLMTCPServer {
  private static instance: LLMTCPServer
  private _isLLMEnabled = false

  get isLLMEnabled(): boolean {
    return this._isLLMEnabled
  }

  constructor(
    private readonly host: string,
    private readonly port: number
  ) {
    if (!LLMTCPServer.instance) {
      LogHelper.title('LLM TCP Server')
      LogHelper.success('New instance')

      LLMTCPServer.instance = this
    }

    this.host = host
    this.port = port
  }

  public async init(): Promise<void> {
    LogHelper.title('LLM TCP Server')

    const freeRAMInGB = SystemHelper.getFreeRAM()

    /**
     * In case the LLM is not set up and
     * the current free RAM is enough to load the LLM
     */
    if (!fs.existsSync(LLM_PATH) && LLM_MINIMUM_FREE_RAM <= freeRAMInGB) {
      LogHelper.warning(
        'The LLM is not set up yet whereas the current free RAM is enough to enable it. You can run the following command to set it up: "npm install"'
      )
      return
    }
    /**
     * In case the LLM is set up and
     * the current free RAM is not enough to load the LLM
     */
    if (fs.existsSync(LLM_PATH) && LLM_MINIMUM_FREE_RAM > freeRAMInGB) {
      LogHelper.warning(
        'There is not enough free RAM to load the LLM. So the LLM will not be enabled.'
      )
      return
    }

    /* try {
      await this.loadModel()

      this._isLLMEnabled = true
    } catch (e) {
    } */

    LogHelper.title('Initialization')
    LogHelper.info(
      `Starting the LLM TCP server on tcp://${this.host}:${this.port}`
    )

    return

    // create server
    // load model
    // TODO: once really loaded?
  }
}

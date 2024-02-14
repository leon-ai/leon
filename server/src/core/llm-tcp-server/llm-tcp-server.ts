import fs from 'node:fs'
import Net from 'node:net'

import { LLM_MINIMUM_FREE_RAM, LLM_PATH } from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import { SystemHelper } from '@/helpers/system-helper'
// import { LLMDuty } from '@/core/llm-tcp-server/llm-duty'

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

    const server = new Net.Server()

    server.listen(this.port, this.host, () => {
      LogHelper.success(
        `The LLM TCP server is listening on tcp://${this.host}:${this.port}`
      )
    })

    server.on('connection', (socket) => {
      LogHelper.title('Client')
      LogHelper.success('Connected')

      socket.on('data', (data) => {
        LogHelper.title('Client')
        LogHelper.info(`Received data: ${data}`)

        const parsedData = JSON.parse(data.toString())

        LogHelper.info(parsedData)
      })

      socket.on('error', (err) => {
        LogHelper.error(`Error: ${err}`)
      })

      socket.on('end', () => {
        LogHelper.title('Client')
        LogHelper.error('Disconnected')
      })
    })

    /* try {
      await this.loadModel()

      this._isLLMEnabled = true
    } catch (e) {
    } */

    console.log('LOADING...')

    const { LlamaModel, LlamaContext } = await import('node-llama-cpp')

    /**
     * @see https://withcatai.github.io/node-llama-cpp/api/type-aliases/LlamaModelOptions
     */
    const model = new LlamaModel({
      modelPath: LLM_PATH
    })

    console.log('MODEL END LOADING', model)

    /**
     * @see https://withcatai.github.io/node-llama-cpp/api/type-aliases/LlamaContextOptions
     */
    const context = new LlamaContext({
      model,
      contextSize: 8_096,
      threads: 4
    })

    console.log('CONTEXT END LOADING', context)

    // const duty = new LLMDuty(LL)

    LogHelper.info(
      `Starting the LLM TCP server on tcp://${this.host}:${this.port}`
    )

    /*ee.emit('infer', {
      duty: '',
      prompt: ''
    })*/

    return

    // create server
    // load model
    // TODO: once really loaded?
  }
}

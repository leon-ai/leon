import fs from 'node:fs'

import type { LlamaModel, LlamaContext } from 'node-llama-cpp'

import { LLM_MINIMUM_FREE_RAM, LLM_PATH } from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import { SystemHelper } from '@/helpers/system-helper'

type LLMManagerModel = LlamaModel | null
type LLMManagerContext = LlamaContext | null

export default class LLMManager {
  private static instance: LLMManager
  private _isLLMEnabled = false
  private _model: LLMManagerModel = null
  private _context: LLMManagerContext = null

  get model(): LlamaModel {
    return this._model as LlamaModel
  }

  get context(): LlamaContext {
    return this._context as LlamaContext
  }

  get isLLMEnabled(): boolean {
    return this._isLLMEnabled
  }

  constructor() {
    if (!LLMManager.instance) {
      LogHelper.title('LLM Manager')
      LogHelper.success('New instance')

      LLMManager.instance = this
    }
  }

  public async loadLLM(): Promise<void> {
    LogHelper.title('LLM Manager')

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

    try {
      const { LlamaModel, LlamaContext } = await import('node-llama-cpp')

      /**
       * @see https://withcatai.github.io/node-llama-cpp/api/type-aliases/LlamaModelOptions
       */
      this._model = new LlamaModel({
        modelPath: LLM_PATH
      })

      /**
       * @see https://withcatai.github.io/node-llama-cpp/api/type-aliases/LlamaContextOptions
       */
      this._context = new LlamaContext({
        model: this._model,
        contextSize: 8_096,
        threads: 4
      })

      this._isLLMEnabled = true

      LogHelper.success('LLM has been loaded')
    } catch (e) {
      LogHelper.error(`LLM Manager failed to load: ${e}`)
    }
  }
}

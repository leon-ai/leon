import type { LlamaChatSession } from 'node-llama-cpp'

import {
  type LLMDutyParams,
  type LLMDutyResult,
  type LLMDutyInitParams,
  type LLMDutyExecuteParams,
  LLMDuty,
  DEFAULT_INIT_PARAMS,
  DEFAULT_EXECUTE_PARAMS
} from '@/core/llm-manager/llm-duty'
import { LogHelper } from '@/helpers/log-helper'
import {
  EVENT_EMITTER,
  LLM_MANAGER,
  LLM_PROVIDER,
  PERSONA,
  SOCKET_SERVER
} from '@/core'
import { LLMProviders, LLMDuties } from '@/core/llm-manager/types'
import { LLM_PROVIDER as LLM_PROVIDER_NAME } from '@/constants'
import { StringHelper } from '@/helpers/string-helper'

type ParaphraseLLMDutyParams = LLMDutyParams

export class ParaphraseLLMDuty extends LLMDuty {
  private static instance: ParaphraseLLMDuty
  private static session: LlamaChatSession = null as unknown as LlamaChatSession
  protected static finalSystemPrompt = ''
  protected systemPrompt = `You are an AI system that generates answers (Natural Language Generation).
You must provide a text alternative according to your current mood and your personality.
Never indicate that it's a modified version.
Do not interpret the text, just paraphrase it.
You do not ask question if the original text does not contain any.
If there are data in the original text, make sure to provide them.

Examples:

Modify this text: I added your items to the shopping list.
I included the items you mentioned to the shopping list. Happy shopping!

Modify this text: the sun is a star.
The sun is a star, it is the closest star to Earth.`
  protected readonly name = 'Paraphrase LLM Duty'
  protected input: LLMDutyParams['input'] = null

  constructor(params: ParaphraseLLMDutyParams) {
    super()

    if (!ParaphraseLLMDuty.instance) {
      LogHelper.title(this.name)
      LogHelper.success('New instance')

      ParaphraseLLMDuty.instance = this

      EVENT_EMITTER.on('persona_new-mood-set', async () => {
        await this.init({ force: true })
      })
      EVENT_EMITTER.on('persona_new-info-set', async () => {
        await this.init({ force: true })
      })
    }

    this.input = params.input
  }

  public async init(
    params: LLMDutyInitParams = DEFAULT_INIT_PARAMS
  ): Promise<void> {
    if (LLM_PROVIDER_NAME === LLMProviders.Local) {
      if (!ParaphraseLLMDuty.session || params.force) {
        LogHelper.title(this.name)
        LogHelper.info('Initializing...')

        try {
          const { LlamaChatSession } = await Function(
            'return import("node-llama-cpp")'
          )()

          /**
           * Dispose the previous session and sequence
           * to give space for the new one
           */
          if (params.force) {
            ParaphraseLLMDuty.session.dispose({ disposeSequence: true })
            LogHelper.info('Session disposed')
          }

          ParaphraseLLMDuty.finalSystemPrompt = PERSONA.getDutySystemPrompt(
            this.systemPrompt
          )

          ParaphraseLLMDuty.session = new LlamaChatSession({
            contextSequence: LLM_MANAGER.context.getSequence(),
            autoDisposeSequence: true,
            systemPrompt: ParaphraseLLMDuty.finalSystemPrompt
          }) as LlamaChatSession

          LogHelper.success('Initialized')
        } catch (e) {
          LogHelper.title(this.name)
          LogHelper.error(`Failed to initialize: ${e}`)
        }
      }
    }
  }

  public async execute(
    params: LLMDutyExecuteParams = DEFAULT_EXECUTE_PARAMS
  ): Promise<LLMDutyResult | null> {
    LogHelper.title(this.name)
    LogHelper.info('Executing...')

    try {
      const prompt = `Modify the following text but do not say you modified it: ${this.input}`
      const config = LLM_MANAGER.coreLLMDuties[LLMDuties.Paraphrase]
      const completionParams = {
        dutyType: LLMDuties.Paraphrase,
        systemPrompt: ParaphraseLLMDuty.finalSystemPrompt,
        temperature: config?.temperature,
        thoughtTokensBudget: config?.thoughtTokensBudget
      }
      let completionResult

      if (LLM_PROVIDER_NAME === LLMProviders.Local) {
        /*const history = await LLM_MANAGER.loadHistory(
          CONVERSATION_LOGGER,
          session: ParaphraseLLMDuty.session,
        )*/
        /**
         * Only the first (system prompt) messages is used
         * to provide some context
         */
        // ParaphraseLLMDuty.session.setChatHistory([history[0], history[history.length - 1]])
        // ParaphraseLLMDuty.session.setChatHistory([history[0]])

        const generationId = StringHelper.random(6, { onlyLetters: true })
        completionResult = await LLM_PROVIDER.prompt(prompt, {
          ...completionParams,
          session: ParaphraseLLMDuty.session,
          onToken: (chunk) => {
            if (!params.isWarmingUp && !params.shouldEmitOnToken) {
              const detokenizedChunk = LLM_PROVIDER.cleanUpResult(
                LLM_MANAGER.model.detokenize(chunk)
              )

              SOCKET_SERVER.socket?.emit('llm-token', {
                token: detokenizedChunk,
                generationId
              })
            }
          }
        })
      } else {
        completionResult = await LLM_PROVIDER.prompt(prompt, completionParams)
      }

      LogHelper.title(this.name)
      LogHelper.success('Duty executed')
      LogHelper.success(`Prompt — ${prompt}`)
      LogHelper.success(`Output — ${completionResult?.output}
usedInputTokens: ${completionResult?.usedInputTokens}
usedOutputTokens: ${completionResult?.usedOutputTokens}`)

      return completionResult as unknown as LLMDutyResult
    } catch (e) {
      LogHelper.title(this.name)
      LogHelper.error(`Failed to execute: ${e}`)
    }

    return null
  }
}

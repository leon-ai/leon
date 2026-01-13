import {
  LlamaChat,
  LlamaChatSession,
  type LlamaChatResponse
} from 'node-llama-cpp'

import type {
  CompletionParams,
  PromptOrChatHistory
} from '@/core/llm-manager/types'
import { LogHelper } from '@/helpers/log-helper'
import { LLM_MANAGER } from '@/core'

type LocalCompletionParams = Omit<CompletionParams, ''>

export default class LocalLLMProvider {
  protected readonly name = 'Local LLM Provider'

  constructor() {
    LogHelper.title(this.name)
    LogHelper.success('New instance')
  }

  public runChatCompletion(
    promptOrChatHistory: PromptOrChatHistory,
    completionParams: LocalCompletionParams
  ): Promise<string | LlamaChatResponse<never>> {
    return new Promise(async (resolve, reject) => {
      try {
        if (!completionParams.session) {
          return reject(new Error('Session is not defined'))
        }

        const isJSONMode = completionParams.data !== null
        let promptParams: Record<string, unknown> = {
          functions: completionParams.functions,
          maxTokens: completionParams.maxTokens as number,
          temperature: completionParams.temperature as number,
          onToken: completionParams.onToken as (tokens: unknown) => void,
          budgets: {
            thoughtTokens: completionParams.thoughtTokensBudget
          }
        }

        if (isJSONMode) {
          const grammar = await LLM_MANAGER.llama.createGrammarForJsonSchema({
            type: 'object',
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            properties: completionParams.data
          })

          promptParams = {
            ...promptParams,
            grammar
          }
        }

        let promise = null

        /**
         * LlamaChat and LlamaChatSession have different methods for generating responses.
         * We use LlamaChat for function calling and LlamaChatSession for simple prompts
         */
        if (
          completionParams.session instanceof LlamaChat &&
          Array.isArray(promptOrChatHistory)
        ) {
          promise = completionParams.session.generateResponse(
            promptOrChatHistory,
            promptParams
          )
        } else if (
          completionParams.session instanceof LlamaChatSession &&
          typeof promptOrChatHistory === 'string'
        ) {
          promise = completionParams.session.prompt(
            promptOrChatHistory,
            promptParams
          )
        } else {
          LogHelper.title(this.name)
          const errorMessage = 'Invalid session or prompt type'
          LogHelper.error(errorMessage)
          return reject(new Error(errorMessage))
        }

        return resolve(promise)
      } catch (e) {
        LogHelper.title(this.name)
        const errorMessage = `Failed to run completion: ${e}`
        LogHelper.error(errorMessage)
        return reject(new Error(errorMessage))
      }
    })
  }
}

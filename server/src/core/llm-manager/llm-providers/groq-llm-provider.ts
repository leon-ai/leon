import axios, { type AxiosError, type AxiosResponse } from 'axios'

import type {
  CompletionParams,
  PromptOrChatHistory
} from '@/core/llm-manager/types'
import { LogHelper } from '@/helpers/log-helper'

/**
 * @see https://console.groq.com/docs/text-chat
 */
enum GroqModels {
  Llama3_8b_8192 = 'llama3-8b-8192',
  Llama3_70b_8192 = 'llama3-70b-8192',
  Mixtral_8x7b_32768 = 'mixtral-8x7b-32768',
  Gemma_7b_It = 'gemma-7b-it'
}
interface GroqMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  name?: string
  seed?: number
}
interface GroqChatCompletionParams {
  model: GroqModels
  messages: GroqMessage[]
  max_tokens?: number
  temperature?: number
  top_p?: number
  stream?: boolean
  stop?: string | null
  grammar?: unknown
  response_format?: {
    type: 'json_object'
  }
}
type GroqCompletionParams = Omit<CompletionParams, ''>

export default class GroqLLMProvider {
  protected readonly name = 'Groq LLM Provider'
  protected readonly apiKey = process.env['LEON_LLM_PROVIDER_API_KEY']
  private readonly axios = axios.create({
    baseURL: 'https://api.groq.com/openai/v1',
    timeout: 7_000
  })

  constructor() {
    LogHelper.title(this.name)
    LogHelper.success('New instance')

    this.checkAPIKey()
  }

  private checkAPIKey(): void {
    if (!this.apiKey || this.apiKey === '') {
      LogHelper.title(this.name)

      const errorMessage = `${this.name} API key is not defined. Please define it in the .env file`
      LogHelper.error(errorMessage)
      throw new Error(errorMessage)
    }
  }

  public runChatCompletion(
    prompt: PromptOrChatHistory,
    completionParams: GroqCompletionParams
  ): Promise<AxiosResponse> {
    return new Promise(async (resolve, reject) => {
      try {
        this.checkAPIKey()

        const isJSONMode = completionParams.data !== null

        let { systemPrompt } = completionParams
        if (isJSONMode) {
          systemPrompt = `${
            completionParams.systemPrompt
          }. Use a JSON format by following this schema: ${JSON.stringify(
            completionParams.data
          )}`
        }

        let messagesHistory: GroqMessage[] = []
        if (completionParams.history) {
          messagesHistory = completionParams.history.map((message) => {
            if (message.who === 'leon') {
              return {
                role: 'assistant',
                content: message.message
              }
            }

            return {
              role: 'user',
              content: message.message
            }
          })
        }

        messagesHistory = [
          {
            role: 'system',
            content: systemPrompt
          },
          ...messagesHistory
        ]

        // Make sure to add the new prompt (message) to the history
        const lastMessage = messagesHistory[messagesHistory.length - 1]
        if (messagesHistory.length === 0 || lastMessage?.content !== prompt) {
          messagesHistory.push({
            role: 'user',
            content: prompt as string
          })
        }

        let chatCompletionParams: GroqChatCompletionParams = {
          messages: messagesHistory,
          model: GroqModels.Llama3_8b_8192,
          temperature: completionParams.temperature || 0,
          stream: false
        }

        if (isJSONMode) {
          chatCompletionParams = {
            ...chatCompletionParams,
            response_format: {
              type: 'json_object'
            }
          }
        }

        const promise = this.axios.request({
          url: '/chat/completions',
          method: 'POST',
          data: chatCompletionParams,
          transformResponse: (data) => {
            return data
          },
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`
          }
        })

        return resolve(promise)
      } catch (e) {
        const err = e as Error | AxiosError
        let errorMessage = `Failed to run completion: ${err}`

        if (axios.isAxiosError(err)) {
          errorMessage = `Failed to run completion (AxiosError): ${err.response?.data}`
        }

        LogHelper.title(this.name)
        LogHelper.error(errorMessage)
        return reject(new Error(errorMessage))
      }
    })
  }
}

import path from 'node:path'

import type { AxiosResponse } from 'axios'

import {
  type CompletionParams,
  LLMDuties,
  LLMProviders
} from '@/core/llm-manager/types'
import { LLM_PROVIDER, SERVER_CORE_PATH } from '@/constants'
import { LogHelper } from '@/helpers/log-helper'
import { FileHelper } from '@/helpers/file-helper'
import LocalLLMProvider from '@/core/llm-manager/llm-providers/local-llm-provider'
import GroqLLMProvider from '@/core/llm-manager/llm-providers/groq-llm-provider'

interface CompletionResult {
  dutyType: LLMDuties
  systemPrompt: string
  input: string
  output: string
  data: Record<string, unknown> | null
  maxTokens: number
  usedInputTokens: number
  usedOutputTokens: number
  temperature: number
}
interface NormalizedCompletionResult {
  rawResult: string
  usedInputTokens: number
  usedOutputTokens: number
}
type Provider = LocalLLMProvider | GroqLLMProvider | undefined

const LLM_PROVIDERS_MAP = {
  [LLMProviders.Local]: 'local-llm-provider',
  [LLMProviders.Groq]: 'groq-llm-provider'
}
const DEFAULT_MAX_EXECUTION_TIMOUT = 32_000
const DEFAULT_MAX_EXECUTION_RETRIES = 2
const DEFAULT_TEMPERATURE = 0 // Disabled
const DEFAULT_MAX_TOKENS = 8_192

export default class LLMProvider {
  private static instance: LLMProvider

  private llmProvider: Provider = undefined

  constructor() {
    if (!LLMProvider.instance) {
      LogHelper.title('LLM Provider')
      LogHelper.success('New instance')

      LLMProvider.instance = this
    }
  }

  public get isLLMProviderReady(): boolean {
    return !!this.llmProvider
  }

  /**
   * Initialize the LLM provider
   */
  public async init(): Promise<boolean> {
    LogHelper.title('LLM Provider')
    LogHelper.info('Initializing LLM provider...')

    if (!Object.values(LLMProviders).includes(LLM_PROVIDER as LLMProviders)) {
      LogHelper.error(
        `The LLM provider "${LLM_PROVIDER}" does not exist or is not yet supported`
      )

      return false
    }

    // Dynamically set the provider
    const { default: provider } = await FileHelper.dynamicImportFromFile(
      path.join(
        SERVER_CORE_PATH,
        'llm-manager',
        'llm-providers',
        `${LLM_PROVIDERS_MAP[LLM_PROVIDER as LLMProviders]}.js`
      )
    )
    this.llmProvider = new provider()

    LogHelper.title('LLM Provider')
    LogHelper.success(`Initialized with "${LLM_PROVIDER}" provider`)

    return true
  }

  private normalizeCompletionResultForLocalProvider(
    rawResult: string,
    completionParams: CompletionParams
  ): NormalizedCompletionResult {
    if (!completionParams.session) {
      return {
        rawResult,
        usedInputTokens: 0,
        usedOutputTokens: 0
      }
    }

    const { usedInputTokens, usedOutputTokens } =
      completionParams.session.sequence.tokenMeter.getState()

    return {
      rawResult,
      usedInputTokens,
      usedOutputTokens
    }
  }

  private normalizeCompletionResultForGroqProvider(
    rawResult: AxiosResponse
  ): NormalizedCompletionResult {
    const parsedCompletionResult = JSON.parse(rawResult.data)

    return {
      rawResult: parsedCompletionResult.choices[0].message.content,
      usedInputTokens: parsedCompletionResult.usage.prompt_tokens,
      usedOutputTokens: parsedCompletionResult.usage.completion_tokens
    }
  }

  public cleanUpResult(str: string): string {
    // If starts and end with a double quote, remove them
    if (str.startsWith('"') && str.endsWith('"')) {
      return str.slice(1, -1)
    }

    str = str.replace(/\*laugh\*/g, '😂')
    str = str.replace(/\*winks?\*/g, '😉')
    str = str.replace(/\*sigh\*/g, '😔')

    return str
  }

  /**
   * Run the completion inference
   */
  public async prompt(
    prompt: string,
    completionParams: CompletionParams
  ): Promise<CompletionResult | null> {
    LogHelper.title('LLM Provider')
    LogHelper.info(`Using "${LLM_PROVIDER}" provider for completion...`)

    if (!this.llmProvider) {
      LogHelper.error('LLM provider is not ready')
      return null
    }

    completionParams.dutyType = completionParams.dutyType || null
    completionParams.timeout =
      completionParams.timeout || DEFAULT_MAX_EXECUTION_TIMOUT
    completionParams.maxRetries =
      completionParams.maxRetries || DEFAULT_MAX_EXECUTION_RETRIES
    completionParams.data = completionParams.data || null
    completionParams.temperature =
      completionParams.temperature || DEFAULT_TEMPERATURE
    completionParams.maxTokens =
      completionParams.maxTokens || DEFAULT_MAX_TOKENS
    /**
     * TODO: support onToken (stream) for Groq provider too
     */
    completionParams.onToken = completionParams.onToken || ((): void => {})

    const isJSONMode = completionParams.data !== null

    const rawResultPromise = this.llmProvider.runChatCompletion(
      prompt,
      completionParams
    )

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), completionParams.timeout)
    )

    let rawResult
    let rawResultString

    try {
      rawResult = await Promise.race([rawResultPromise, timeoutPromise])
    } catch (e) {
      LogHelper.title('LLM Provider')
      LogHelper.error(`Error to complete prompt: ${e}`)

      // throw new Error('Prompt failed after all retries')
      return null

      /*// Avoid infinite loop
      if (!completionParams.maxRetries || completionParams.maxRetries <= 0) {
        throw new Error('Prompt failed after all retries')
      }

      if (completionParams.maxRetries > 0) {
        LogHelper.info('Prompt took too long or failed. Retrying...')

        return this.prompt(prompt, {
          ...completionParams,
          maxRetries: completionParams.maxRetries - 1
        })
      } else {
        LogHelper.error(
          `Prompt failed after ${completionParams.maxRetries} retries`
        )

        return null
      }*/
    }

    let usedInputTokens = 0
    let usedOutputTokens = 0

    /**
     * Normalize the completion result according to the provider
     */
    if (LLM_PROVIDER === LLMProviders.Local) {
      if (completionParams.session) {
        const {
          rawResult: result,
          usedInputTokens: inputTokens,
          usedOutputTokens: outputTokens
        } = this.normalizeCompletionResultForLocalProvider(
          rawResult as string,
          completionParams
        )

        rawResult = result
        usedInputTokens = inputTokens
        usedOutputTokens = outputTokens
      }
    } else if (LLM_PROVIDER === LLMProviders.Groq) {
      const {
        rawResult: result,
        usedInputTokens: inputTokens,
        usedOutputTokens: outputTokens
      } = this.normalizeCompletionResultForGroqProvider(
        rawResult as AxiosResponse
      )

      rawResult = result
      usedInputTokens = inputTokens
      usedOutputTokens = outputTokens
    } else {
      LogHelper.error(`The LLM provider "${LLM_PROVIDER}" is not yet supported`)
      return null
    }

    rawResultString = rawResult as string

    rawResultString = this.cleanUpResult(rawResultString)

    if (isJSONMode) {
      // If a closing bracket is missing, add it
      if (rawResultString[rawResultString.length - 1] !== '}') {
        rawResultString += '}'
      }
    }

    return {
      dutyType: completionParams.dutyType,
      systemPrompt: completionParams.systemPrompt,
      temperature: completionParams.temperature,
      input: prompt,
      output: isJSONMode ? JSON.parse(rawResultString) : rawResultString,
      data: completionParams.data,
      maxTokens: completionParams.maxTokens,
      // Current used context size
      usedInputTokens,
      usedOutputTokens
    }
  }
}

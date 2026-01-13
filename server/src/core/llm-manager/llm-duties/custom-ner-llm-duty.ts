import type { LlamaChatSession } from 'node-llama-cpp'

import {
  type LLMDutyParams,
  type LLMDutyInitParams,
  type LLMDutyResult,
  LLMDuty,
  DEFAULT_INIT_PARAMS
} from '@/core/llm-manager/llm-duty'
import { LogHelper } from '@/helpers/log-helper'
import { LLM_MANAGER, LLM_PROVIDER } from '@/core'
import { LLMProviders, LLMDuties } from '@/core/llm-manager/types'
import { LLM_PROVIDER as LLM_PROVIDER_NAME } from '@/constants'

interface CustomNERLLMDutyParams<T> extends LLMDutyParams {
  data: {
    schema: T
  }
}

export class CustomNERLLMDuty<T> extends LLMDuty {
  private static instance: CustomNERLLMDuty<unknown>
  private static session: LlamaChatSession = null as unknown as LlamaChatSession
  protected readonly systemPrompt =
    'You are an AI system that extracts entities (Named-Entity Recognition) from a given utterance. E.g. shopping list name = "shopping".'
  protected readonly name = 'Custom NER LLM Duty'
  protected input: LLMDutyParams['input'] = null
  protected data = {
    schema: null
  } as CustomNERLLMDutyParams<T>['data']

  constructor(params: CustomNERLLMDutyParams<T>) {
    super()

    if (!CustomNERLLMDuty.instance) {
      LogHelper.title(this.name)
      LogHelper.success('New instance')

      CustomNERLLMDuty.instance = this
    }

    this.input = params.input
    this.data = params.data
  }

  public async init(
    params: LLMDutyInitParams = DEFAULT_INIT_PARAMS
  ): Promise<void> {
    if (LLM_PROVIDER_NAME === LLMProviders.Local) {
      if (!CustomNERLLMDuty.session || params.force) {
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
            CustomNERLLMDuty.session.dispose({ disposeSequence: true })
            LogHelper.info('Session disposed')
          }

          CustomNERLLMDuty.session = new LlamaChatSession({
            contextSequence: LLM_MANAGER.context.getSequence(),
            autoDisposeSequence: true,
            systemPrompt: this.systemPrompt
          })

          LogHelper.success('Initialized')
        } catch (e) {
          LogHelper.title(this.name)
          LogHelper.error(`Failed to initialize: ${e}`)
        }
      }
    }
  }

  public async execute(): Promise<LLMDutyResult | null> {
    LogHelper.title(this.name)
    LogHelper.info('Executing...')

    try {
      const prompt = `UTTERANCE TO PARSE:\n"${this.input}"`
      const completionParams = {
        dutyType: LLMDuties.CustomNER,
        systemPrompt: this.systemPrompt,
        data: this.data.schema as unknown as Record<string, unknown>
      }
      let completionResult

      if (LLM_PROVIDER_NAME === LLMProviders.Local) {
        completionResult = await LLM_PROVIDER.prompt(prompt, {
          ...completionParams,
          session: CustomNERLLMDuty.session
        })
      } else {
        completionResult = await LLM_PROVIDER.prompt(prompt, completionParams)
      }

      LogHelper.title(this.name)
      LogHelper.success('Duty executed')
      LogHelper.success(`Prompt — ${prompt}`)
      LogHelper.success(`Output — ${JSON.stringify(completionResult?.output)}
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

import type { LlamaChatSession, LlamaContext } from 'node-llama-cpp'

import {
  type LLMDutyParams,
  type LLMDutyResult,
  LLMDuty
} from '@/core/llm-manager/llm-duty'
import { LogHelper } from '@/helpers/log-helper'
import { LLM_MANAGER, LLM_PROVIDER } from '@/core'
import { LLMProviders, LLMDuties } from '@/core/llm-manager/types'
import { LLM_PROVIDER as LLM_PROVIDER_NAME } from '@/constants'

interface CustomLLMDutyParams extends LLMDutyParams {
  // Use snake_case since triggered from skills
  data: {
    system_prompt?: string | null
    thought_tokens_budget?: number
    temperature?: number
    max_tokens?: number
    // Used to know when to clear the context/session
    disposeTimeout?: number
  }
}

const DEFAULT_DISPOSE_TIMEOUT = 60_000
/**
 * This duty isn't a core duty, hence the config
 * can be added here instead of in the LLMManager
 */
const DEFAULT_THOUGHT_TOKENS_BUDGET = 128
const DEFAULT_TEMPERATURE = 0

export class CustomLLMDuty extends LLMDuty {
  private static instance: CustomLLMDuty
  private static context: LlamaContext = null as unknown as LlamaContext
  private static session: LlamaChatSession = null as unknown as LlamaChatSession
  private static disposeTimeoutMs = DEFAULT_DISPOSE_TIMEOUT
  private static disposeTimer: NodeJS.Timeout | null = null
  // Track the current system prompt used for the session
  private static currentSystemPrompt: string | null = null
  protected systemPrompt = ''
  protected readonly name = 'Custom LLM Duty'
  protected input: LLMDutyParams['input'] = null
  protected data = {
    system_prompt: null,
    thought_tokens_budget: DEFAULT_THOUGHT_TOKENS_BUDGET,
    temperature: DEFAULT_TEMPERATURE
  } as CustomLLMDutyParams['data']

  constructor(params: CustomLLMDutyParams) {
    super()

    if (!CustomLLMDuty.instance) {
      LogHelper.title(this.name)
      LogHelper.success('New instance')

      CustomLLMDuty.instance = this
    }

    this.input = params.input
    this.data = params.data

    CustomLLMDuty.disposeTimeoutMs =
      params.data.disposeTimeout ?? DEFAULT_DISPOSE_TIMEOUT
  }

  /**
   * Start a timer or clear it so we can run
   * this duty faster if it runs within the time window
   * of the disposable timer
   */
  private resetDisposeTimer(): void {
    // Clear an existing timer
    if (CustomLLMDuty.disposeTimer) {
      clearTimeout(CustomLLMDuty.disposeTimer)
    }

    // Start a new timer
    CustomLLMDuty.disposeTimer = setTimeout(async () => {
      if (CustomLLMDuty.session) {
        CustomLLMDuty.session.dispose({ disposeSequence: true })
        CustomLLMDuty.session = null as never
      }

      if (CustomLLMDuty.context) {
        await CustomLLMDuty.context.dispose()
        CustomLLMDuty.context = null as never
      }

      // Clear the timer reference and reset system prompt after disposal
      CustomLLMDuty.disposeTimer = null
      CustomLLMDuty.currentSystemPrompt = null

      LogHelper.title(this.name)
      LogHelper.info(
        `CustomLLMDuty context/session disposed after ${CustomLLMDuty.disposeTimeoutMs}ms of inactivity`
      )
    }, CustomLLMDuty.disposeTimeoutMs)
  }

  /**
   * Manually dispose resources and clear timer
   */
  public static async dispose(): Promise<void> {
    if (CustomLLMDuty.disposeTimer) {
      clearTimeout(CustomLLMDuty.disposeTimer)
      CustomLLMDuty.disposeTimer = null
    }

    if (CustomLLMDuty.session) {
      CustomLLMDuty.session.dispose({ disposeSequence: true })
      CustomLLMDuty.session = null as never
    }

    if (CustomLLMDuty.context) {
      await CustomLLMDuty.context.dispose()
      CustomLLMDuty.context = null as never
    }

    // Reset system prompt after manual disposal
    CustomLLMDuty.currentSystemPrompt = null

    LogHelper.title(this.name)
    LogHelper.info('CustomLLMDuty resources manually disposed')
  }

  public async init(): Promise<void> {
    if (LLM_PROVIDER_NAME === LLMProviders.Local) {
      try {
        this.resetDisposeTimer()

        /**
         * Create a new context and session if it doesn't exist or if the system prompt has changed
         */
        if (
          !CustomLLMDuty.context ||
          !CustomLLMDuty.session ||
          this.data.system_prompt !== CustomLLMDuty.currentSystemPrompt
        ) {
          LogHelper.title(this.name)
          LogHelper.info('Initializing...')

          if (CustomLLMDuty.context) {
            await CustomLLMDuty.context.dispose()
          }
          if (CustomLLMDuty.session) {
            CustomLLMDuty.session.dispose({ disposeSequence: true })
          }

          CustomLLMDuty.currentSystemPrompt = this.data.system_prompt || ''

          CustomLLMDuty.context = await LLM_MANAGER.model.createContext()

          const { LlamaChatSession } = await Function(
            'return import("node-llama-cpp")'
          )()

          CustomLLMDuty.session = new LlamaChatSession({
            contextSequence: CustomLLMDuty.context.getSequence(),
            autoDisposeSequence: true,
            systemPrompt: CustomLLMDuty.currentSystemPrompt
          }) as LlamaChatSession

          LogHelper.success('Initialized')
        }
      } catch (e) {
        LogHelper.title(this.name)
        LogHelper.error(`Failed to initialize: ${e}`)
      }
    }
  }

  public async execute(): Promise<LLMDutyResult | null> {
    LogHelper.title(this.name)
    LogHelper.info('Executing...')

    try {
      this.resetDisposeTimer()

      const prompt = this.input as string
      const completionParams = {
        dutyType: LLMDuties.Custom,
        systemPrompt: CustomLLMDuty.currentSystemPrompt as string,
        temperature: this.data.temperature,
        maxTokens: this.data.max_tokens,
        thoughtTokensBudget: this.data.thought_tokens_budget
      }
      let completionResult

      if (LLM_PROVIDER_NAME === LLMProviders.Local) {
        completionResult = await LLM_PROVIDER.prompt(prompt, {
          ...completionParams,
          session: CustomLLMDuty.session,
          temperature: this.data.temperature
            ? this.data.temperature
            : DEFAULT_TEMPERATURE,
          thoughtTokensBudget: this.data.thought_tokens_budget
            ? this.data.thought_tokens_budget
            : DEFAULT_THOUGHT_TOKENS_BUDGET,
          maxTokens: this.data.max_tokens
            ? this.data.max_tokens
            : CustomLLMDuty.context.contextSize
        })
      } else {
        completionResult = await LLM_PROVIDER.prompt(prompt, completionParams)
      }

      LogHelper.title(this.name)
      LogHelper.success('Duty executed')
      LogHelper.success(`System prompt — ${CustomLLMDuty.currentSystemPrompt}`)
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

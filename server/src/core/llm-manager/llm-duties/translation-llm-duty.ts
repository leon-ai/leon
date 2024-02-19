import {
  type LLMDutyParams,
  type LLMDutyResult,
  LLMDuty
} from '@/core/llm-manager/llm-duty'
import { LogHelper } from '@/helpers/log-helper'
import { LLM_MANAGER } from '@/core'
import { LLMDuties } from '@/core/llm-manager/types'

interface TranslationLLMDutyParams extends LLMDutyParams {
  data: {
    source?: string | null
    target: string | null
    autoDetectLanguage?: boolean
  }
}

export class TranslationLLMDuty extends LLMDuty {
  protected readonly systemPrompt: LLMDutyParams['systemPrompt'] = null
  protected readonly name = 'Translation LLM Duty'
  protected input: LLMDutyParams['input'] = null
  protected data = {
    source: null,
    target: null,
    autoDetectLanguage: false
  } as TranslationLLMDutyParams['data']

  constructor(params: TranslationLLMDutyParams) {
    super()

    LogHelper.title(this.name)
    LogHelper.success('New instance')

    this.input = params.input
    this.data = params.data

    if (this.data.autoDetectLanguage && !this.data.source) {
      this.systemPrompt = `You are an AI system that can translate text to "${this.data.target}" by auto-detecting the source language.`
    } else {
      this.systemPrompt = `You are an AI system that can translate text from "${this.data.source}" to "${this.data.target}".`
    }
  }

  public async execute(): Promise<LLMDutyResult | null> {
    LogHelper.title(this.name)
    LogHelper.info('Executing...')

    try {
      const { LlamaChatSession, LlamaJsonSchemaGrammar } = await import(
        'node-llama-cpp'
      )

      const session = new LlamaChatSession({
        context: LLM_MANAGER.context,
        systemPrompt: this.systemPrompt as string
      })
      const grammar = new LlamaJsonSchemaGrammar({
        type: 'object',
        properties: {
          o: {
            type: 'string'
          }
        }
      })
      const prompt = this.input as string

      const rawResult = await session.prompt(prompt, {
        grammar,
        maxTokens: LLM_MANAGER.context.getContextSize()
      })
      const parsedResult = grammar.parse(rawResult)
      const result = {
        dutyType: LLMDuties.Translation,
        systemPrompt: this.systemPrompt,
        input: this.input,
        output: parsedResult,
        data: this.data
      }

      LogHelper.title(this.name)
      LogHelper.success(`Duty executed: ${JSON.stringify(result)}`)

      return result
    } catch (e) {
      LogHelper.title(this.name)
      LogHelper.error(`Failed to execute: ${e}`)
    }

    return null
  }
}

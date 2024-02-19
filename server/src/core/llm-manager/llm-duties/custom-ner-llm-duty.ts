import {
  type LLMDutyParams,
  type LLMDutyResult,
  LLMDuty
} from '@/core/llm-manager/llm-duty'
import { LogHelper } from '@/helpers/log-helper'
import { LLM_MANAGER } from '@/core'
import { LLMDuties } from '@/core/llm-manager/types'

interface CustomNERLLMDutyParams<T> extends LLMDutyParams {
  data: {
    schema: T
  }
}

export class CustomNERLLMDuty<T> extends LLMDuty {
  protected readonly systemPrompt =
    'You are an AI system that can extract entities (Named-Entity Recognition) from utterances. E.g. shopping list name = "shopping".'
  protected readonly name = 'Custom NER LLM Duty'
  protected input: LLMDutyParams['input'] = null
  protected data = {
    schema: null
  } as CustomNERLLMDutyParams<T>['data']

  constructor(params: CustomNERLLMDutyParams<T>) {
    super()

    LogHelper.title(this.name)
    LogHelper.success('New instance')

    this.input = params.input
    this.data = params.data
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
        systemPrompt: this.systemPrompt
      })
      const grammar = new LlamaJsonSchemaGrammar({
        type: 'object',
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        properties: {
          ...this.data.schema
        }
      })
      const prompt = this.input as string

      const rawResult = await session.prompt(prompt, {
        grammar,
        maxTokens: LLM_MANAGER.context.getContextSize()
      })
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      const parsedResult = grammar.parse(rawResult)
      const result = {
        dutyType: LLMDuties.CustomNER,
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

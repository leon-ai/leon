import {
  type LLMDutyParams,
  type LLMDutyResult,
  LLMDuty
} from '@/core/llm-manager/llm-duty'
import { LogHelper } from '@/helpers/log-helper'
import { LLM_MANAGER } from '@/core'
import { LLMDuties } from '@/core/llm-manager/types'

interface SummarizationLLMDutyParams extends LLMDutyParams {}

export class SummarizationLLMDuty extends LLMDuty {
  protected readonly systemPrompt =
    'You are an AI system that can summarize text in a few sentences.'
  protected readonly name = 'Summarization LLM Duty'
  protected input: LLMDutyParams['input'] = null

  constructor(params: SummarizationLLMDutyParams) {
    super()

    LogHelper.title(this.name)
    LogHelper.success('New instance')

    this.input = params.input
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
        dutyType: LLMDuties.Summarization,
        systemPrompt: this.systemPrompt,
        input: this.input,
        output: parsedResult,
        data: null
      }

      LogHelper.title(this.name)
      LogHelper.success(`Duty executed: ${JSON.stringify(result)}`)

      return result as unknown as LLMDutyResult
    } catch (e) {
      LogHelper.title(this.name)
      LogHelper.error(`Failed to execute: ${e}`)
    }

    return null
  }
}

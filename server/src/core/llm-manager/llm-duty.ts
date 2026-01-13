/**
 * Duties:
 *
 * [OK] Custom NER
 * [OK] Summarization
 * [OK] Translation
 * [OK] Paraphraser
 * Knowledge base / RAG
 * Question answering
 * Sentiment analysis
 * [OK] Conversation
 * Intent fallback
 * Custom prompting (for specific use cases in skills)
 */
import { LLMDuties } from '@/core/llm-manager/types'

export interface LLMDutyInitParams {
  /**
   * Whether to use the loop history which is erased when Leon's instance is restarted.
   * If set to false, the main conversation history will be used
   */
  useLoopHistory?: boolean
  /**
   * Force duty reinitialization
   */
  force?: boolean
}
export interface LLMDutyExecuteParams {
  isWarmingUp?: boolean
  shouldEmitOnToken?: boolean
}
export interface LLMDutyParams {
  input: string | object | null
  data?: Record<string, unknown>
  systemPrompt?: string | null
}
export interface LLMDutyResult {
  dutyType: LLMDuties
  systemPrompt: LLMDutyParams['systemPrompt']
  input: LLMDutyParams['input']
  output: Record<string, unknown>
  data: Record<string, unknown>
}
interface LLMFunctionParameter {
  type: string
  description: string
}

export const DEFAULT_INIT_PARAMS: LLMDutyInitParams = {
  useLoopHistory: true,
  force: false
}
export const DEFAULT_EXECUTE_PARAMS: LLMDutyExecuteParams = {
  isWarmingUp: false,
  shouldEmitOnToken: true
}
const PARAMETER_TYPE_DESCRIPTIONS = {
  boolean: {
    suffix: 'The value must be either true or false.'
  }
}

export abstract class LLMDuty {
  protected abstract readonly name: string
  protected abstract systemPrompt: LLMDutyParams['systemPrompt']
  protected abstract input: LLMDutyParams['input']

  protected abstract init(params: LLMDutyInitParams): Promise<void>
  protected abstract execute(
    params: LLMDutyExecuteParams
  ): Promise<LLMDutyResult | null>
}

/**
 * Overriding the slot description to add more details
 * according to the slot type
 */
export function formatParameterDescription(
  parameter: LLMFunctionParameter
): LLMFunctionParameter['description'] {
  let description = parameter.description.trim()

  // If there is no dot at the end of the description, add one
  if (!description.endsWith('.')) {
    description = `${description}.`
  }

  // Add more details according to the parameter type
  if (
    PARAMETER_TYPE_DESCRIPTIONS[
      parameter.type as keyof typeof PARAMETER_TYPE_DESCRIPTIONS
    ]
  ) {
    description = `${description} ${
      PARAMETER_TYPE_DESCRIPTIONS[
        parameter.type as keyof typeof PARAMETER_TYPE_DESCRIPTIONS
      ].suffix
    }`
  }

  return description
}

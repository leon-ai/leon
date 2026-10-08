import { LLM_PROVIDER } from '@/core'
import { LLMDuties, type InferencePurpose } from '@/core/llm-manager/types'

export interface InferenceOptions {
  prompt: string
  usagePurpose?: InferencePurpose
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  thoughtTokensBudget?: number
  jsonSchema?: Record<string, unknown>
  disableThinking?: boolean
  reasoningMode?: 'off' | 'guarded' | 'on'
  trackProviderErrors?: boolean
}

export interface InferenceResult {
  output: string
  reasoning?: string
  usedInputTokens: number
  usedOutputTokens: number
  generationDurationMs?: number
  providerDecodeDurationMs?: number
  providerTokensPerSecond?: number
}

export async function runInference(
  options: InferenceOptions
): Promise<InferenceResult | null> {
  const completionParams = {
    dutyType: LLMDuties.Inference,
    ...(options.usagePurpose ? { usagePurpose: options.usagePurpose } : {}),
    systemPrompt: options.systemPrompt ?? '',
    ...(options.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options.thoughtTokensBudget !== undefined
      ? { thoughtTokensBudget: options.thoughtTokensBudget }
      : {}),
    data: options.jsonSchema ?? null,
    ...(options.disableThinking !== undefined
      ? { disableThinking: options.disableThinking }
      : {}),
    ...(options.reasoningMode !== undefined
      ? { reasoningMode: options.reasoningMode }
      : {}),
    ...(options.trackProviderErrors !== undefined
      ? { trackProviderErrors: options.trackProviderErrors }
      : {})
  }
  const result = await LLM_PROVIDER.prompt(options.prompt, completionParams)

  if (!result) {
    return null
  }

  const inferenceResult: InferenceResult = {
    output: result.output,
    usedInputTokens: result.usedInputTokens,
    usedOutputTokens: result.usedOutputTokens
  }

  if (result.reasoning !== undefined) {
    inferenceResult.reasoning = result.reasoning
  }
  if (result.generationDurationMs !== undefined) {
    inferenceResult.generationDurationMs = result.generationDurationMs
  }
  if (result.providerDecodeDurationMs !== undefined) {
    inferenceResult.providerDecodeDurationMs = result.providerDecodeDurationMs
  }
  if (result.providerTokensPerSecond !== undefined) {
    inferenceResult.providerTokensPerSecond = result.providerTokensPerSecond
  }

  return inferenceResult
}

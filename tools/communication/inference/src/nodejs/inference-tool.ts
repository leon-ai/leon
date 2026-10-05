import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

interface CompletionOptions {
  prompt: string
  system_prompt?: string
  temperature?: number
  max_tokens?: number
  thought_tokens_budget?: number
  disable_thinking?: boolean
  reasoning_mode?: 'off' | 'guarded' | 'on'
  track_provider_errors?: boolean
}

interface StructuredCompletionOptions extends CompletionOptions {
  json_schema: Record<string, unknown>
}

interface InferenceResponse {
  success: boolean
  output?: unknown
  reasoning?: string
  usedInputTokens?: number
  usedOutputTokens?: number
  generationDurationMs?: number
  providerDecodeDurationMs?: number
  providerTokensPerSecond?: number
  error?: string
}

export default class InferenceTool extends Tool {
  private static readonly TOOLKIT = 'communication'
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    this.config = ToolkitConfig.load(InferenceTool.TOOLKIT, this.toolName)
  }

  get toolName(): string {
    return 'inference'
  }

  get toolkit(): string {
    return InferenceTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  async completion(options: CompletionOptions): Promise<InferenceResponse> {
    return this.requestLeon<InferenceResponse>('/inference', {
      prompt: options.prompt,
      systemPrompt: options.system_prompt,
      temperature: options.temperature,
      maxTokens: options.max_tokens,
      thoughtTokensBudget: options.thought_tokens_budget,
      disableThinking: options.disable_thinking,
      reasoningMode: options.reasoning_mode,
      trackProviderErrors: options.track_provider_errors
    })
  }

  async structuredCompletion(
    options: StructuredCompletionOptions
  ): Promise<InferenceResponse> {
    return this.requestLeon<InferenceResponse>('/inference', {
      prompt: options.prompt,
      systemPrompt: options.system_prompt,
      temperature: options.temperature,
      maxTokens: options.max_tokens,
      thoughtTokensBudget: options.thought_tokens_budget,
      jsonSchema: options.json_schema,
      disableThinking: options.disable_thinking,
      reasoningMode: options.reasoning_mode,
      trackProviderErrors: options.track_provider_errors
    })
  }
}

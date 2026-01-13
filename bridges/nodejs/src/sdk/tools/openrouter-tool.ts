import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { Network, NetworkError } from '@sdk/network'

interface ChatMessage {
  role: string
  content: string
}

interface ChatCompletionOptions {
  messages: ChatMessage[]
  model?: string
  temperature?: number
  max_tokens?: number
  system_prompt?: string
  use_structured_output?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json_schema?: Record<string, any>
}

interface CompletionOptions {
  prompt: string
  model?: string
  temperature?: number
  max_tokens?: number
  system_prompt?: string
  use_structured_output?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json_schema?: Record<string, any>
}

interface StructuredCompletionOptions {
  prompt: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json_schema: Record<string, any>
  model?: string
  temperature?: number
  max_tokens?: number
  system_prompt?: string
}

interface ApiResponse {
  success: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any
  model_used?: string
  error?: string
  status_code?: number
}

export default class OpenRouterTool extends Tool {
  private static readonly TOOLKIT = 'communication'
  private readonly config: ReturnType<typeof ToolkitConfig.load>
  private api_key?: string
  private readonly network: Network

  // Popular models available on OpenRouter
  private readonly popular_models = {
    // OpenAI Models - Latest GPT-5 and o-series
    'gpt-5': 'openai/gpt-5',
    'gpt-4o': 'openai/gpt-4o-2024-11-20',
    'gpt-4o-mini': 'openai/gpt-4o-mini-2024-07-18',
    o1: 'openai/o1',
    'o1-mini': 'openai/o1-mini',
    'o1-preview': 'openai/o1-preview',
    'o3-mini': 'openai/o3-mini',
    'gpt-4-turbo': 'openai/gpt-4-turbo',

    // Anthropic Models - Latest Claude 4 and 3.7 series
    'claude-4-sonnet': 'anthropic/claude-4-sonnet-20250522',
    'claude-3.7-sonnet': 'anthropic/claude-3.7-sonnet-20250109',
    'claude-3.5-sonnet': 'anthropic/claude-3.5-sonnet-20241022',
    'claude-3.5-haiku': 'anthropic/claude-3.5-haiku-20241022',
    'claude-3-opus': 'anthropic/claude-3-opus',
    'claude-3-sonnet': 'anthropic/claude-3-sonnet',

    // Google Models - Gemini 2.0 and 2.5 series
    'gemini-2.5-flash': 'google/gemini-2.5-flash',
    'gemini-2.5-pro': 'google/gemini-2.5-pro',
    'gemini-2.0-flash': 'google/gemini-2.0-flash',
    'gemini-1.5-pro': 'google/gemini-1.5-pro',
    'gemini-1.5-flash': 'google/gemini-1.5-flash-002',

    // DeepSeek Models - Latest V3 and R1 reasoning models
    'deepseek-r1': 'deepseek/deepseek-r1',
    'deepseek-v3': 'deepseek/deepseek-v3',
    'deepseek-chat': 'deepseek/deepseek-chat',

    // Qwen Models - Latest Qwen 3 Coder series (July 2025)
    'qwen-3-coder': 'qwen/qwen-3-coder-32b-instruct',
    'qwen-2.5-max': 'qwen/qwen-2.5-max',
    'qwen-2.5-72b': 'qwen/qwen-2.5-72b-instruct',

    // Moonshot AI Kimi Models - Latest K2 (July 2025)
    'kimi-k2': 'moonshotai/kimi-k2-instruct',
    'kimi-k1.5': 'moonshotai/kimi-k1.5',

    // Meta Llama Models - Latest 3.3 and 3.2 series
    'llama-3.3-70b': 'meta-llama/llama-3.3-70b-instruct',
    'llama-3.2-90b': 'meta-llama/llama-3.2-90b-vision-instruct',
    'llama-3.2-11b': 'meta-llama/llama-3.2-11b-vision-instruct',
    'llama-3.1-405b': 'meta-llama/llama-3.1-405b-instruct',
    'llama-3.1-70b': 'meta-llama/llama-3.1-70b-instruct',
    'llama-3.1-8b': 'meta-llama/llama-3.1-8b-instruct',

    // Mistral Models - Latest Large 2 series
    'mistral-large-2': 'mistralai/mistral-large-2',
    'mistral-small': 'mistralai/mistral-small',
    'mixtral-8x7b': 'mistralai/mixtral-8x7b-instruct',

    // xAI Grok Models - Latest Grok 3 series
    'grok-3': 'x-ai/grok-3',
    'grok-2': 'x-ai/grok-2-1212',

    // Cohere Models
    'command-r-plus': 'cohere/command-r-plus',
    'command-r': 'cohere/command-r',

    // Other High-Performance Models
    'yi-large': 'yi/yi-large'
  }

  constructor(apiKey?: string) {
    super()
    // Load configuration from central toolkits directory
    const toolConfigName = this.constructor.name
      .toLowerCase()
      .replace('tool', '')
    this.config = ToolkitConfig.load(OpenRouterTool.TOOLKIT, toolConfigName)
    this.api_key = apiKey
    this.network = new Network({ baseURL: 'https://openrouter.ai/api' })
  }

  get toolName(): string {
    return this.constructor.name
  }

  get toolkit(): string {
    return OpenRouterTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Set the OpenRouter API key
   */
  setApiKey(apiKey: string): void {
    this.api_key = apiKey
  }

  /**
   * Get list of popular available models
   */
  getAvailableModels(): string[] {
    return Object.keys(this.popular_models)
  }

  /**
   * Convert friendly model name to OpenRouter model ID
   */
  getModelId(modelName: string): string {
    return (
      this.popular_models[modelName as keyof typeof this.popular_models] ||
      modelName
    )
  }

  /**
   * Send a chat completion request to OpenRouter
   */
  async chatCompletion(options: ChatCompletionOptions): Promise<ApiResponse> {
    const {
      messages,
      model = 'gemini-2.5-flash',
      temperature = 0.7,
      max_tokens,
      system_prompt,
      use_structured_output = false,
      json_schema
    } = options

    if (!this.api_key) {
      return {
        success: false,
        error: 'OpenRouter API key not configured'
      }
    }

    // Convert friendly model name to OpenRouter ID
    const modelId = this.getModelId(model)

    // Prepare messages with system prompt if provided
    const requestMessages = []
    if (system_prompt) {
      requestMessages.push({ role: 'system', content: system_prompt })
    }
    requestMessages.push(...messages)

    // Prepare request payload
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      model: modelId,
      messages: requestMessages,
      temperature
    }

    if (max_tokens) {
      payload.max_tokens = max_tokens
    }

    // Add structured output configuration if requested
    if (use_structured_output && json_schema) {
      payload.response_format = {
        type: 'json_schema',
        json_schema: {
          name: json_schema['name'] || 'response',
          strict: true,
          schema: json_schema['schema']
        }
      }
    }

    try {
      const response = await this.network.request({
        url: '/v1/chat/completions',
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.api_key}`,
          'Content-Type': 'application/json'
        },
        data: payload
      })

      return {
        success: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: response.data as any,
        model_used: modelId
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: `OpenRouter API error: ${(error as Error).message}`,
        status_code:
          error instanceof NetworkError ? error.response.statusCode : undefined
      }
    }
  }

  /**
   * General text completion for any use case
   */
  async completion(options: CompletionOptions): Promise<ApiResponse> {
    const {
      prompt,
      model = 'gemini-2.5-flash',
      temperature = 0.7,
      max_tokens,
      system_prompt,
      use_structured_output = false,
      json_schema
    } = options

    const messages = [{ role: 'user', content: prompt }]

    const response = await this.chatCompletion({
      messages,
      model,
      temperature,
      max_tokens,
      system_prompt,
      use_structured_output,
      json_schema
    })

    if (!response.success) {
      return response
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content = (response.data as any).choices[0].message.content

      return {
        success: true,
        data: { content },
        model_used: response.model_used
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: `Failed to extract completion: ${(error as Error).message}`
      }
    }
  }

  /**
   * Generate structured JSON output using OpenRouter's structured outputs feature
   */
  async structuredCompletion(
    options: StructuredCompletionOptions
  ): Promise<ApiResponse> {
    const {
      prompt,
      json_schema,
      model = 'gemini-2.5-flash',
      temperature = 0.7,
      max_tokens,
      system_prompt
    } = options

    const messages = [{ role: 'user', content: prompt }]

    const response = await this.chatCompletion({
      messages,
      model,
      temperature,
      max_tokens,
      system_prompt,
      use_structured_output: true,
      json_schema
    })

    if (!response.success) {
      return response
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content = (response.data as any).choices[0].message.content
      // With structured outputs, content is already valid JSON
      const parsedData = JSON.parse(content)

      return {
        success: true,
        data: parsedData,
        model_used: response.model_used
      }
    } catch (error: unknown) {
      if (error instanceof SyntaxError) {
        return {
          success: false,
          error: `Failed to parse JSON response: ${error.message}`
        }
      } else {
        return {
          success: false,
          error: `Failed to extract completion: ${(error as Error).message}`
        }
      }
    }
  }

  /**
   * Get list of available models from OpenRouter API
   */
  async listModels(): Promise<ApiResponse> {
    if (!this.api_key) {
      return {
        success: false,
        error: 'OpenRouter API key not configured'
      }
    }

    try {
      const response = await this.network.request({
        url: '/v1/models',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.api_key}`
        }
      })

      return {
        success: true,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { models: (response.data as any).data }
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: `Failed to fetch models: ${(error as Error).message}`
      }
    }
  }
}

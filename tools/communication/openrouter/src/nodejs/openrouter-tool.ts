import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { Network, NetworkError } from '@sdk/network'

// Hardcoded default settings for OpenRouter tool
const OPENROUTER_API_KEY: string | null = null
const OPENROUTER_MODEL = 'google/gemini-3-flash-preview'
const DEFAULT_SETTINGS: Record<string, unknown> = {
  OPENROUTER_API_KEY,
  OPENROUTER_MODEL
}
const REQUIRED_SETTINGS = ['OPENROUTER_API_KEY']

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
  private api_key: string | null
  private model: string
  private readonly network: Network

  constructor(apiKey?: string) {
    super()
    // Load configuration from central toolkits directory
    this.config = ToolkitConfig.load(OpenRouterTool.TOOLKIT, this.toolName)

    const toolSettings = ToolkitConfig.loadToolSettings(
      OpenRouterTool.TOOLKIT,
      this.toolName,
      DEFAULT_SETTINGS
    )
    this.settings = toolSettings
    this.requiredSettings = REQUIRED_SETTINGS
    this.checkRequiredSettings(this.toolName)

    // Priority: skill-provided apiKey > toolkit settings > hardcoded default
    this.api_key =
      apiKey ||
      (this.settings['OPENROUTER_API_KEY'] as string) ||
      OPENROUTER_API_KEY

    // Load model from toolkit settings or hardcoded default
    this.model =
      (this.settings['OPENROUTER_MODEL'] as string) || OPENROUTER_MODEL

    this.network = new Network({ baseURL: 'https://openrouter.ai/api' })
  }

  get toolName(): string {
    return 'openrouter'
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
   * Send a chat completion request to OpenRouter
   */
  async chatCompletion(options: ChatCompletionOptions): Promise<ApiResponse> {
    const {
      messages,
      model,
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

    // Use default model if none provided
    const finalModel = model || this.model

    // Prepare messages with system prompt if provided
    const requestMessages = []
    if (system_prompt) {
      requestMessages.push({ role: 'system', content: system_prompt })
    }
    requestMessages.push(...messages)

    // Prepare request payload
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      model: finalModel,
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
        model_used: finalModel
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
      model,
      temperature = 0.7,
      max_tokens,
      system_prompt,
      use_structured_output = false,
      json_schema
    } = options

    const messages = [{ role: 'user', content: prompt }]

    const response = await this.chatCompletion({
      messages,
      model: model || this.model,
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
      model,
      temperature = 0.7,
      max_tokens,
      system_prompt
    } = options

    const messages = [{ role: 'user', content: prompt }]

    const response = await this.chatCompletion({
      messages,
      model: model || this.model,
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
      const parsedData =
        typeof content === 'string' ? JSON.parse(content) : content

      return {
        success: true,
        data: parsedData,
        model_used: response.model_used
      }
    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content = (response.data as any).choices[0]?.message?.content

      if (error instanceof SyntaxError) {
        // Show raw response preview to help debug JSON parsing errors
        const preview =
          typeof content === 'string'
            ? content.substring(0, 500)
            : JSON.stringify(content ?? 'null').substring(0, 500)

        return {
          success: false,
          error: `Failed to parse JSON response: ${error.message}. Response preview: ${preview}`
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

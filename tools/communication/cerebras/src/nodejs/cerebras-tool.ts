import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { Network, NetworkError } from '@sdk/network'

// Hardcoded default settings for Cerebras tool
const CEREBRAS_API_KEY: string | null = null
const CEREBRAS_MODEL = 'zai-glm-4.7'
const DEFAULT_SETTINGS: Record<string, unknown> = {
  CEREBRAS_API_KEY,
  CEREBRAS_MODEL
}
const REQUIRED_SETTINGS = ['CEREBRAS_API_KEY']

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

export default class CerebrasTool extends Tool {
  private static readonly TOOLKIT = 'communication'
  private readonly config: ReturnType<typeof ToolkitConfig.load>
  private api_key: string | null
  private model: string
  private readonly network: Network

  // Popular Cerebras-hosted models (override with full model IDs if needed)
  private readonly popular_models = {
    'zai-glm-4.7': 'zai-glm-4.7',
    'qwen-3-235b-a22b-instruct-2507': 'qwen-3-235b-a22b-instruct-2507',
    'qwen-3-32b': 'qwen-3-32b'
  }

  constructor(apiKey?: string) {
    super()
    // Load configuration from central toolkits directory
    this.config = ToolkitConfig.load(CerebrasTool.TOOLKIT, this.toolName)

    const toolSettings = ToolkitConfig.loadToolSettings(
      CerebrasTool.TOOLKIT,
      this.toolName,
      DEFAULT_SETTINGS
    )
    this.settings = toolSettings
    this.requiredSettings = REQUIRED_SETTINGS
    this.checkRequiredSettings(this.toolName)

    // Priority: skill-provided apiKey > toolkit settings > hardcoded default
    this.api_key =
      apiKey ||
      (this.settings['CEREBRAS_API_KEY'] as string) ||
      CEREBRAS_API_KEY

    // Load model from toolkit settings or hardcoded default
    this.model = (this.settings['CEREBRAS_MODEL'] as string) || CEREBRAS_MODEL

    this.network = new Network({ baseURL: 'https://api.cerebras.ai/v1' })
  }

  get toolName(): string {
    return 'cerebras'
  }

  get toolkit(): string {
    return CerebrasTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Set the Cerebras API key
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
   * Convert friendly model name to Cerebras model ID
   */
  getModelId(modelName: string): string {
    return (
      this.popular_models[modelName as keyof typeof this.popular_models] ||
      modelName
    )
  }

  /**
   * Send a chat completion request to Cerebras
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
        error: 'Cerebras API key not configured'
      }
    }

    // Use default model if none provided
    const finalModel = model || this.model
    const modelId = this.getModelId(finalModel)

    const requestMessages = []
    if (system_prompt) {
      requestMessages.push({ role: 'system', content: system_prompt })
    }
    requestMessages.push(...messages)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = {
      model: modelId,
      messages: requestMessages,
      temperature
    }

    if (max_tokens) {
      payload.max_tokens = max_tokens
    }

    if (use_structured_output) {
      payload.response_format = { type: 'json_object' }
      if (json_schema) {
        const schemaText = JSON.stringify(json_schema)
        const schemaPrompt = `You must return a valid JSON object that matches this schema:\n${schemaText}`
        payload.messages = [
          { role: 'system', content: schemaPrompt },
          ...requestMessages
        ]
      }
    }

    try {
      const response = await this.network.request({
        url: '/chat/completions',
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
        error: `Cerebras API error: ${(error as Error).message}`,
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
   * Generate structured JSON output using Cerebras structured outputs
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
      }

      return {
        success: false,
        error: `Failed to extract completion: ${(error as Error).message}`
      }
    }
  }

  /**
   * Get list of available models from Cerebras API
   */
  async listModels(): Promise<ApiResponse> {
    if (!this.api_key) {
      return {
        success: false,
        error: 'Cerebras API key not configured'
      }
    }

    try {
      const response = await this.network.request({
        url: '/models',
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

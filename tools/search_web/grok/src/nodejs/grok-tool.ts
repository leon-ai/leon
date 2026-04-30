import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

/**
 * xAI Grok Tool with Server-Side Agentic Search
 * Uses the Responses API (/v1/responses) for tool support
 * Reference: https://docs.x.ai/docs/guides/tools/search-tools
 */

// Hardcoded default settings for Grok tool
const GROK_API_KEY: string | null = null
const GROK_MODEL = 'grok-4-1-fast-reasoning'
const DEFAULT_SETTINGS: Record<string, unknown> = {
  GROK_API_KEY,
  GROK_MODEL
}
const REQUIRED_SETTINGS = ['GROK_API_KEY']

interface GrokMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// xAI Responses API tool format
interface WebSearchTool {
  type: 'web_search'
  allowed_domains?: string[]
  excluded_domains?: string[]
  enable_image_understanding?: boolean
}

interface XSearchTool {
  type: 'x_search'
  allowed_x_handles?: string[]
  excluded_x_handles?: string[]
  from_date?: string
  to_date?: string
  enable_image_understanding?: boolean
  enable_video_understanding?: boolean
}

interface GrokChatOptions {
  input: GrokMessage[] // Responses API uses "input" not "messages"
  model?: string
  temperature?: number
  max_completion_tokens?: number
  stream?: boolean
  tools?: Array<WebSearchTool | XSearchTool>
}

interface Annotation {
  type: string
  url?: string
  start_index?: number
  end_index?: number
  title?: string
}

interface ContentItem {
  type: string
  text?: string
  logprobs?: unknown[]
  annotations?: Annotation[]
}

interface MessageOutput {
  type: 'message'
  id: string
  role: string
  status: string
  content: ContentItem[]
}

interface ToolCallOutput {
  id: string
  type: 'web_search_call' | 'x_search_call'
  status: string
  action: {
    type: string
    query?: string
    url?: string
    sources?: unknown[]
  }
}

type OutputItem = MessageOutput | ToolCallOutput

interface GrokModelsResponse {
  object: string
  data: Array<{
    id: string
    object: string
    created: number
    owned_by: string
  }>
}

interface GrokResponsesApiResponse {
  id: string
  output: OutputItem[]
  usage: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
    reasoning_tokens?: number
  }
}

interface GrokResponse {
  success: boolean
  data?: GrokResponsesApiResponse
  error?: string
  // Convenience helpers
  content?: string
  citations?: string[]
  annotations?: Annotation[]
  [key: string]: unknown
}

export default class GrokTool extends Tool {
  private static readonly TOOLKIT = 'search_web'
  private readonly config: ReturnType<typeof ToolkitConfig.load>
  private apiKey: string | null
  private model: string
  private baseUrl: string = 'https://api.x.ai'

  constructor() {
    super()
    this.config = ToolkitConfig.load(GrokTool.TOOLKIT, this.toolName)

    const toolSettings = ToolkitConfig.loadToolSettings(
      GrokTool.TOOLKIT,
      this.toolName,
      DEFAULT_SETTINGS
    )
    this.settings = toolSettings
    this.requiredSettings = REQUIRED_SETTINGS
    this.checkRequiredSettings(this.toolName)

    // Priority: toolkit settings > hardcoded default
    this.apiKey = (this.settings['GROK_API_KEY'] as string) || GROK_API_KEY
    this.model = (this.settings['GROK_MODEL'] as string) || GROK_MODEL
  }

  get toolName(): string {
    return 'grok'
  }

  get toolkit(): string {
    return GrokTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Set the Grok API key
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey
  }

  /**
   * List available models
   * Reference: https://docs.x.ai/docs/api-reference
   */
  async listModels(): Promise<{
    success: boolean
    data?: GrokModelsResponse
    error?: string
  }> {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'Grok API key is not set. Please call setApiKey() first.'
      }
    }

    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`
        }
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(
          `Grok API error: ${response.status} - ${JSON.stringify(errorData)}`
        )
      }

      const data = await response.json() as GrokModelsResponse

      return {
        success: true,
        data
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: `Failed to list models: ${(error as Error).message}`
      }
    }
  }

  /**
   * Perform a chat completion with Grok using server-side agentic search tools
   * Uses the /v1/responses endpoint (Responses API) for tool support
   * Reference: https://docs.x.ai/docs/guides/tools/search-tools
   */
  async chatCompletion(
    options: GrokChatOptions
  ): Promise<GrokResponse> {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'Grok API key is not set. Please call setApiKey() first.'
      }
    }

    const {
      input,
      model,
      temperature = 0.7,
      max_completion_tokens = 4096,
      stream = false,
      tools
    } = options

    // Use default model if none provided
    const finalModel = model || this.model

    try {
      const requestBody: Record<string, unknown> = {
        model: finalModel,
        input,
        temperature,
        max_completion_tokens,
        stream
      }

      // Add server-side search tools if provided
      if (tools && tools.length > 0) {
        requestBody['tools'] = tools
      }

      // Use /v1/responses endpoint for tools support (not /v1/chat/completions)
      const response = await fetch(`${this.baseUrl}/v1/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(
          `Grok API error: ${response.status} - ${JSON.stringify(errorData)}`
        )
      }

      const data = await response.json() as GrokResponsesApiResponse

      // Extract the final text output from the output array
      let content = ''
      let annotations: Annotation[] = []
      let citations: string[] = []

      if (data.output && Array.isArray(data.output)) {
        // Find the message item (type: "message")
        for (let i = data.output.length - 1; i >= 0; i--) {
          const item = data.output[i]
          if (!item || item.type !== 'message' || !Array.isArray(item.content)) {
            continue
          }

          // Find output_text in the content array
          for (const contentItem of item.content) {
            if (contentItem.type === 'output_text' && contentItem.text) {
              content = contentItem.text
              annotations = contentItem.annotations || []
              // Extract URLs from annotations for citations
              citations = annotations
                .filter((a) => a.url)
                .map((a) => a.url as string)
              break
            }
          }
          break
        }
      }

      return {
        success: true,
        data,
        content,
        citations,
        annotations
      }
    } catch (error: unknown) {
      return {
        success: false,
        error: `Failed to complete chat: ${(error as Error).message}`
      }
    }
  }

  /**
   * Search the web using Grok's server-side agentic web search tool
   * The model will autonomously call the web_search tool during reasoning
   * Reference: https://docs.x.ai/docs/guides/tools/search-tools
   */
  async searchWeb(
    query: string,
    options?: {
      allowed_domains?: string[] // Max 5
      excluded_domains?: string[] // Max 5
      enable_image_understanding?: boolean
    }
  ): Promise<GrokResponse> {
    const webSearchTool: WebSearchTool = {
      type: 'web_search',
      ...options
    }

    return this.chatCompletion({
      input: [
        {
          role: 'user',
          content: query
        }
      ],
      model: this.model,
      temperature: 0.5,
      tools: [webSearchTool]
    })
  }

  /**
   * Search X/Twitter using Grok's server-side agentic X search tool
   * The model will autonomously call the x_search tool during reasoning
   * Reference: https://docs.x.ai/docs/guides/tools/search-tools
   */
  async searchX(
    query: string,
    options?: {
      allowed_x_handles?: string[] // Max 10
      excluded_x_handles?: string[] // Max 10
      from_date?: string // ISO8601: "YYYY-MM-DD"
      to_date?: string // ISO8601: "YYYY-MM-DD"
      enable_image_understanding?: boolean
      enable_video_understanding?: boolean
    }
  ): Promise<GrokResponse> {
    const xSearchTool: XSearchTool = {
      type: 'x_search',
      ...options
    }

    return this.chatCompletion({
      input: [
        {
          role: 'user',
          content: query
        }
      ],
      model: this.model,
      temperature: 0.5,
      tools: [xSearchTool]
    })
  }

  /**
   * Search both web and X using both server-side search tools
   * The model will autonomously call both tools during reasoning
   * Reference: https://docs.x.ai/docs/guides/tools/search-tools
   */
  async search(
    query: string,
    options?: {
      web_options?: {
        allowed_domains?: string[]
        excluded_domains?: string[]
        enable_image_understanding?: boolean
      }
      x_options?: {
        allowed_x_handles?: string[]
        excluded_x_handles?: string[]
        from_date?: string
        to_date?: string
        enable_image_understanding?: boolean
        enable_video_understanding?: boolean
      }
    }
  ): Promise<GrokResponse> {
    const tools: Array<WebSearchTool | XSearchTool> = []

    // Add web search tool
    const webSearchTool: WebSearchTool = {
      type: 'web_search',
      ...options?.web_options
    }
    tools.push(webSearchTool)

    // Add X search tool
    const xSearchTool: XSearchTool = {
      type: 'x_search',
      ...options?.x_options
    }
    tools.push(xSearchTool)

    return this.chatCompletion({
      input: [
        {
          role: 'user',
          content: query
        }
      ],
      model: this.model,
      temperature: 0.5,
      tools
    })
  }

  /**
   * Perform deep research on a topic using web search
   * The model will iteratively call search tools to gather comprehensive information
   * Reference: https://docs.x.ai/docs/guides/tools/search-tools
   */
  async deepResearch(
    topic: string,
    focusAreas?: string[],
    options?: {
      allowed_domains?: string[]
    }
  ): Promise<GrokResponse> {
    const focusText =
      focusAreas && focusAreas.length > 0
        ? `Focus on these specific areas: ${focusAreas.join(', ')}.`
        : ''

    const prompt = `Conduct comprehensive research on: ${topic}

${focusText}

Provide a detailed analysis including:
1. Overview and key findings
2. Recent developments and trends
3. Important statistics and data
4. Expert opinions and credible sources
5. Relevant links and references

Use web search to gather current and accurate information.`

    return this.searchWeb(prompt, {
      ...(options?.allowed_domains
        ? { allowed_domains: options.allowed_domains }
        : {}),
      enable_image_understanding: true
    })
  }

  /**
   * Get what's trending on X/Twitter
   * Reference: https://docs.x.ai/docs/guides/tools/search-tools
   */
  async getTrendingOnX(
    location?: string
  ): Promise<GrokResponse> {
    const locationText = location ? ` in ${location}` : ' globally'
    const prompt = `What are the top trending topics and discussions on X/Twitter${locationText} right now? Provide details about each trend including what it's about and key posts.`

    return this.searchX(prompt, {
      enable_image_understanding: true
    })
  }
}

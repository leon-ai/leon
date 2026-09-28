import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

interface GenerationOptions {
  prompt: string
  filename?: string
  options?: Record<string, unknown>
}

export default class AudioTool extends Tool {
  private readonly config = ToolkitConfig.load('media_generation', 'audio')

  get toolName(): string {
    return 'audio'
  }
  get toolkit(): string {
    return 'media_generation'
  }
  get description(): string {
    return this.config.description
  }

  /**
   * Lists endpoint capabilities and configured accounts before selecting a model.
   */
  public async capabilities(): Promise<unknown> {
    const sessionId = this.executionContext?.conversationSessionId

    return this.requestLeon(
      `/media-generation${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''}`
    )
  }

  /**
   * Generates audio output through Core and returns durable artifact references.
   */
  public async generate(input: GenerationOptions): Promise<unknown> {
    const sessionId = this.executionContext?.conversationSessionId

    if (!sessionId) {
      throw new Error('Generation requires a conversation session.')
    }

    const { prompt, filename, options } = input

    return this.requestLeon('/media-generation', {
      prompt,
      filename,
      options,
      kind: 'audio',
      session_id: sessionId
    })
  }

  /**
   * Honors an owner's explicit provider/model choice without changing defaults.
   */
  public async generateWithModel(
    input: GenerationOptions & { provider: string, model: string }
  ): Promise<unknown> {
    const sessionId = this.executionContext?.conversationSessionId

    if (!sessionId) {
      throw new Error('Generation requires a conversation session.')
    }

    return this.requestLeon('/media-generation', {
      ...input,
      kind: 'audio',
      session_id: sessionId
    })
  }

  /**
   * Remembers an owner-approved generation preference on the server profile.
   */
  public async configure(
    provider: string,
    model = 'auto',
    options: Record<string, unknown> = {}
  ): Promise<unknown> {
    return this.requestLeon('/media-generation/audio/settings', {
      provider,
      model,
      options
    })
  }
}

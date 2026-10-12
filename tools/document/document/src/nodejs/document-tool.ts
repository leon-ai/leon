import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeDocument, type DocumentContent } from './lib/document-writer'
import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

interface GenerationOptions {
  prompt: string
  filename?: string
  options?: Record<string, unknown>
}

export default class DocumentTool extends Tool {
  private readonly config = ToolkitConfig.load('document', 'document')

  get toolName(): string {
    return 'document'
  }
  get toolkit(): string {
    return 'document'
  }
  get description(): string {
    return this.config.description
  }

  /**
   * Creates a local Word document without a generation-provider account.
   */
  public async create(
    format: 'docx',
    content: DocumentContent
  ): Promise<unknown> {
    if (format !== 'docx') {
      throw new Error('Use DOCX here, or document.typst.compile for PDF.')
    }

    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-document-'))

    try {
      const filename = path.join(temporary, `document.${format}`)

      await writeDocument(filename, content)

      return {
        artifacts: [
          await this.createArtifact(
            filename,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          )
        ]
      }
    } finally {
      await fs.rm(temporary, { recursive: true, force: true })
    }
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
   * Generates document output through Core and returns durable artifact references.
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
      kind: 'document',
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
      kind: 'document',
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
    return this.requestLeon('/media-generation/document/settings', {
      provider,
      model,
      options
    })
  }
}

import { ConnectionRequiredError, Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const API_BASE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/'
const REQUEST_TIMEOUT_MS = 30_000

interface GmailPart {
  mimeType?: string
  filename?: string
  body?: { data?: string }
  headers?: Array<{ name: string, value: string }>
  parts?: GmailPart[]
}

interface GmailMessage {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: GmailPart
}

/**
 * Calls Gmail's API with credentials supplied by the profile connection store.
 */
export default class GmailTool extends Tool {
  private readonly config = ToolkitConfig.load(this.toolkit, this.toolName)

  get toolName(): string {
    return 'gmail'
  }
  get toolkit(): string {
    return 'communication'
  }
  get description(): string {
    return this.config.description
  }

  /**
   * Reads the connected mailbox address and counts.
   */
  async getProfile(): Promise<unknown> {
    return this.request('profile')
  }

  /**
   * Lists Gmail system and owner-defined labels.
   */
  async listLabels(): Promise<unknown> {
    return this.request('labels')
  }

  /**
   * Searches message IDs while preserving Google's pagination token.
   */
  async listMessages(
    options: { query?: string, pageToken?: string, maxResults?: number } = {}
  ): Promise<unknown> {
    const query = new URLSearchParams({
      maxResults: String(options.maxResults ?? 20)
    })

    if (options.query) {
      query.set('q', options.query)
    }

    if (options.pageToken) {
      query.set('pageToken', options.pageToken)
    }

    return this.request(`messages?${query}`)
  }

  /**
   * Reads a message and decodes inline MIME text, without fetching attachments.
   */
  async getMessage(options: { messageId: string }): Promise<unknown> {
    const message = (await this.request(
      `messages/${encodeURIComponent(options.messageId)}?format=full`
    )) as GmailMessage
    const plain: string[] = []
    const html: string[] = []
    const readPart = (part: GmailPart): void => {
      // MIME bodies may be nested multipart/alternative or multipart/mixed parts.
      if (!part.filename && part.body?.data) {
        const decoded = Buffer.from(part.body.data, 'base64url').toString(
          'utf8'
        )

        if (part.mimeType === 'text/plain') {
          plain.push(decoded)
        } else if (part.mimeType === 'text/html') {
          html.push(decoded)
        }
      }

      part.parts?.forEach(readPart)
    }

    if (message.payload) {
      readPart(message.payload)
    }

    return {
      id: message.id,
      threadId: message.threadId,
      labelIds: message.labelIds,
      snippet: message.snippet,
      internalDate: message.internalDate,
      headers: message.payload?.headers || [],
      text: plain.join('\n'),
      ...(!plain.length && html.length ? { html: html.join('\n') } : {})
    }
  }

  /**
   * Verifies this account using a read-only provider request.
   */
  public override async validateConnection(): Promise<{
    account_label?: string
  }> {
    const account = (await this.getProfile()) as { emailAddress?: string }
    const label = account.emailAddress

    return label ? { account_label: label } : {}
  }

  /**
   * Keeps authentication checks in the tool and never includes provider bodies in errors.
   */
  private async request(
    resource: string,
    method = 'GET',
    body?: unknown
  ): Promise<unknown> {
    const credentials = this.requireConnectionCredentials()
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const signal = this.executionContext?.signal
      ? AbortSignal.any([this.executionContext.signal, timeoutSignal])
      : timeoutSignal
    const response = await fetch(new URL(resource, API_BASE_URL), {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${String(credentials['access_token'])}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal,
      redirect: 'error'
    })

    if (response.status === 401) {
      throw new ConnectionRequiredError(
        'Reconnect the tool using the connection widget in chat.'
      )
    }

    if (!response.ok) {
      throw new Error(`Gmail request failed (${response.status}).`)
    }

    const text = await response.text()

    return text ? (JSON.parse(text) as unknown) : { success: true }
  }
}

import { ConnectionRequiredError, Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const API_BASE_URL = 'https://api.notion.com/v1/'
const REQUEST_TIMEOUT_MS = 30_000
const NOTION_VERSION = '2026-03-11'

/**
 * Calls Notion's API with credentials supplied by the profile connection store.
 */
export default class NotionTool extends Tool {
  private readonly config = ToolkitConfig.load(this.toolkit, this.toolName)

  get toolName(): string {
    return 'notion'
  }
  get toolkit(): string {
    return 'productivity_collaboration'
  }
  get description(): string {
    return this.config.description
  }

  /**
   * Searches titles of pages and data sources shared with the connection.
   */
  async search(
    options: { query?: string, cursor?: string, pageSize?: number } = {}
  ): Promise<unknown> {
    return this.request('search', 'POST', {
      ...(options.query ? { query: options.query } : {}),
      ...(options.cursor ? { start_cursor: options.cursor } : {}),
      page_size: options.pageSize ?? 20
    })
  }

  /**
   * Retrieves page properties; use getBlockChildren for its contents.
   */
  async getPage(options: { pageId: string }): Promise<unknown> {
    return this.request(`pages/${encodeURIComponent(options.pageId)}`)
  }

  /**
   * Reads a single page of blocks and preserves the continuation cursor.
   */
  async getBlockChildren(options: {
    blockId: string
    cursor?: string
    pageSize?: number
  }): Promise<unknown> {
    const query = this.pagination(options)

    return this.request(
      `blocks/${encodeURIComponent(options.blockId)}/children?${query}`
    )
  }

  /**
   * Creates a child page under an explicitly selected existing page.
   */
  async createPage(options: {
    parentPageId: string
    title: string
    text?: string
    markdown?: string
  }): Promise<unknown> {
    if (options.text !== undefined && options.markdown !== undefined) {
      throw new Error('Provide either text or markdown, not both.')
    }

    return this.request('pages', 'POST', {
      parent: { type: 'page_id', page_id: options.parentPageId },
      properties: {
        title: {
          type: 'title',
          title: [{ type: 'text', text: { content: options.title } }]
        }
      },
      ...(options.text ? { children: [this.paragraph(options.text)] } : {}),
      ...(options.markdown !== undefined ? { markdown: options.markdown } : {})
    })
  }

  /**
   * Appends one text paragraph without replacing existing page content.
   */
  async appendText(options: {
    blockId: string
    text: string
  }): Promise<unknown> {
    return this.request(
      `blocks/${encodeURIComponent(options.blockId)}/children`,
      'PATCH',
      {
        children: [this.paragraph(options.text)]
      }
    )
  }

  /**
   * Retrieve the user or bot associated with this token to identify the connection.
   */
  async getProfile(): Promise<unknown> {
    return this.request('users/me')
  }

  /**
   * List workspace users with pagination. User-information capabilities may be required.
   */
  async listUsers(
    options: { cursor?: string, pageSize?: number } = {}
  ): Promise<unknown> {
    return this.request(`users?${this.pagination(options)}`)
  }

  /**
   * Retrieve an observed Notion user.
   */
  async getUser(options: { userId: string }): Promise<unknown> {
    return this.request(`users/${encodeURIComponent(options.userId)}`)
  }

  /**
   * Retrieve database metadata and its data source IDs.
   */
  async getDatabase(options: { databaseId: string }): Promise<unknown> {
    return this.request(`databases/${encodeURIComponent(options.databaseId)}`)
  }

  /**
   * Retrieve the schema of a data source before querying or writing rows.
   */
  async getDataSource(options: { dataSourceId: string }): Promise<unknown> {
    return this.request(
      `data_sources/${encodeURIComponent(options.dataSourceId)}`
    )
  }

  /**
   * Retrieve an individual block and its type-specific content.
   */
  async getBlock(options: { blockId: string }): Promise<unknown> {
    return this.request(`blocks/${encodeURIComponent(options.blockId)}`)
  }

  /**
   * Read page content as enhanced Markdown; inspect truncation and unknown_block_ids.
   */
  async getPageMarkdown(options: { pageId: string }): Promise<unknown> {
    return this.request(`pages/${encodeURIComponent(options.pageId)}/markdown`)
  }

  /**
   * Retrieve a page property, including paginated relations, rollups, and rich text.
   */
  async getPageProperty(options: {
    pageId: string
    propertyId: string
    cursor?: string
    pageSize?: number
  }): Promise<unknown> {
    // Notion returns short property IDs already percent-encoded; normalize once.
    const propertyId = encodeURIComponent(
      decodeURIComponent(options.propertyId)
    )

    return this.request(
      `pages/${encodeURIComponent(options.pageId)}/properties/${propertyId}?${this.pagination(options)}`
    )
  }

  /**
   * Query data source rows using Notion filters, sorts, and pagination.
   */
  async queryDataSource(options: {
    dataSourceId: string
    filter?: Record<string, unknown>
    sorts?: Record<string, unknown>[]
    cursor?: string
    pageSize?: number
  }): Promise<unknown> {
    return this.request(
      `data_sources/${encodeURIComponent(options.dataSourceId)}/query`,
      'POST',
      {
        ...(options.filter ? { filter: options.filter } : {}),
        ...(options.sorts ? { sorts: options.sorts } : {}),
        ...(options.cursor ? { start_cursor: options.cursor } : {}),
        page_size: options.pageSize ?? 20
      }
    )
  }

  /**
   * Create a database row under a data source using its exact property schema.
   */
  async createDataSourcePage(options: {
    dataSourceId: string
    properties: Record<string, unknown>
    markdown?: string
  }): Promise<unknown> {
    return this.request('pages', 'POST', {
      parent: { type: 'data_source_id', data_source_id: options.dataSourceId },
      properties: options.properties,
      ...(options.markdown !== undefined ? { markdown: options.markdown } : {})
    })
  }

  /**
   * Update page properties, icon, cover, or trash status. Only supplied fields change.
   */
  async updatePage(options: {
    pageId: string
    properties?: Record<string, unknown>
    icon?: Record<string, unknown> | null
    cover?: Record<string, unknown> | null
    inTrash?: boolean
  }): Promise<unknown> {
    const { pageId, inTrash, ...fields } = options

    return this.request(`pages/${encodeURIComponent(pageId)}`, 'PATCH', {
      ...fields,
      ...(inTrash !== undefined ? { in_trash: inTrash } : {})
    })
  }

  /**
   * Make targeted Markdown replacements using exact content read from the page.
   */
  async updatePageMarkdown(options: {
    pageId: string
    updates: {
      old_str: string
      new_str: string
      replace_all_matches?: boolean
    }[]
  }): Promise<unknown> {
    return this.request(
      `pages/${encodeURIComponent(options.pageId)}/markdown`,
      'PATCH',
      {
        type: 'update_content',
        update_content: { content_updates: options.updates }
      }
    )
  }

  /**
   * Replace the entire page body with Markdown when explicitly requested.
   */
  async replacePageMarkdown(options: {
    pageId: string
    markdown: string
  }): Promise<unknown> {
    return this.request(
      `pages/${encodeURIComponent(options.pageId)}/markdown`,
      'PATCH',
      {
        type: 'replace_content',
        replace_content: { new_str: options.markdown }
      }
    )
  }

  /**
   * Append structured blocks such as headings, lists, checkboxes, and tables.
   */
  async appendBlocks(options: {
    blockId: string
    children: Record<string, unknown>[]
  }): Promise<unknown> {
    return this.request(
      `blocks/${encodeURIComponent(options.blockId)}/children`,
      'PATCH',
      { children: options.children }
    )
  }

  /**
   * Update a block using its type-specific Notion fields.
   */
  async updateBlock(options: {
    blockId: string
    content: Record<string, unknown>
  }): Promise<unknown> {
    return this.request(
      `blocks/${encodeURIComponent(options.blockId)}`,
      'PATCH',
      options.content
    )
  }

  /**
   * Move an explicitly selected block to the trash.
   */
  async deleteBlock(options: { blockId: string }): Promise<unknown> {
    return this.request(
      `blocks/${encodeURIComponent(options.blockId)}`,
      'DELETE'
    )
  }

  /**
   * Create a database and its initial data source under a selected page.
   */
  async createDatabase(options: {
    parentPageId: string
    title: string
    properties: Record<string, unknown>
    isInline?: boolean
  }): Promise<unknown> {
    return this.request('databases', 'POST', {
      parent: { type: 'page_id', page_id: options.parentPageId },
      title: this.richText(options.title),
      initial_data_source: { properties: options.properties },
      ...(options.isInline !== undefined ? { is_inline: options.isInline } : {})
    })
  }

  /**
   * Update database title, description, or trash status; schemas belong to data sources.
   */
  async updateDatabase(options: {
    databaseId: string
    title?: string
    description?: string
    inTrash?: boolean
  }): Promise<unknown> {
    return this.request(
      `databases/${encodeURIComponent(options.databaseId)}`,
      'PATCH',
      {
        ...(options.title !== undefined
          ? { title: this.richText(options.title) }
          : {}),
        ...(options.description !== undefined
          ? { description: this.richText(options.description) }
          : {}),
        ...(options.inTrash !== undefined ? { in_trash: options.inTrash } : {})
      }
    )
  }

  /**
   * Add a data source to an existing database.
   */
  async createDataSource(options: {
    databaseId: string
    title: string
    properties: Record<string, unknown>
  }): Promise<unknown> {
    return this.request('data_sources', 'POST', {
      parent: { type: 'database_id', database_id: options.databaseId },
      title: this.richText(options.title),
      properties: options.properties
    })
  }

  /**
   * Update a data source title or property schema, affecting all rows.
   */
  async updateDataSource(options: {
    dataSourceId: string
    title?: string
    properties?: Record<string, unknown>
  }): Promise<unknown> {
    return this.request(
      `data_sources/${encodeURIComponent(options.dataSourceId)}`,
      'PATCH',
      {
        ...(options.title !== undefined
          ? { title: this.richText(options.title) }
          : {}),
        ...(options.properties ? { properties: options.properties } : {})
      }
    )
  }

  /**
   * List unresolved comments on a page or block with pagination.
   */
  async listComments(options: {
    blockId: string
    cursor?: string
    pageSize?: number
  }): Promise<unknown> {
    const query = this.pagination(options)

    query.set('block_id', options.blockId)

    return this.request(`comments?${query}`)
  }

  /**
   * Create a page/block comment or reply to an observed discussion.
   */
  async createComment(options: {
    pageId?: string
    blockId?: string
    discussionId?: string
    text: string
  }): Promise<unknown> {
    if (
      [options.pageId, options.blockId, options.discussionId].filter(Boolean)
        .length !== 1
    ) {
      throw new Error('Provide exactly one pageId, blockId, or discussionId.')
    }

    return this.request('comments', 'POST', {
      ...(options.discussionId
        ? { discussion_id: options.discussionId }
        : {
            parent: options.pageId
              ? { page_id: options.pageId }
              : { block_id: options.blockId }
          }),
      rich_text: this.richText(options.text)
    })
  }

  /**
   * Reuses Notion pagination parameters across list endpoints.
   */
  private pagination(options: {
    cursor?: string
    pageSize?: number
  }): URLSearchParams {
    const query = new URLSearchParams({
      page_size: String(options.pageSize ?? 20)
    })

    if (options.cursor) {
      query.set('start_cursor', options.cursor)
    }

    return query
  }

  /**
   * Builds a plain rich-text value for titles, descriptions, and comments.
   */
  private richText(content: string): Record<string, unknown>[] {
    return [{ type: 'text', text: { content } }]
  }

  /**
   * Builds a paragraph for the simple text convenience method.
   */
  private paragraph(text: string): Record<string, unknown> {
    return {
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: this.richText(text) }
    }
  }

  /**
   * Verifies this account using a read-only provider request.
   */
  public override async validateConnection(): Promise<{
    account_label?: string
  }> {
    const account = (await this.getProfile()) as { name?: string }
    const label = account.name

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
        'Notion-Version': NOTION_VERSION,
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
      throw new Error(`Notion request failed (${response.status}).`)
    }

    const text = await response.text()

    return text ? (JSON.parse(text) as unknown) : { success: true }
  }
}

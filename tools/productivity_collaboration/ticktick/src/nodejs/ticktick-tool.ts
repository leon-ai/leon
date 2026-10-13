import { ConnectionRequiredError, Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const API_BASE_URL = 'https://api.ticktick.com/open/v1/'
const REQUEST_TIMEOUT_MS = 30_000

/**
 * Calls TickTick's API with credentials supplied by the profile connection store.
 */
export default class TickTickTool extends Tool {
  private readonly config = ToolkitConfig.load(this.toolkit, this.toolName)

  get toolName(): string {
    return 'ticktick'
  }
  get toolkit(): string {
    return 'productivity_collaboration'
  }
  get description(): string {
    return this.config.description
  }

  /**
   * Lists projects visible to the authorized TickTick account.
   */
  async listProjects(): Promise<unknown> {
    return this.request('project')
  }

  /**
   * Reads project data, including tasks and columns returned by TickTick.
   */
  async getProjectData(options: { projectId: string }): Promise<unknown> {
    return this.request(`project/${encodeURIComponent(options.projectId)}/data`)
  }

  /**
   * Retrieves a task using IDs from an observed project response.
   */
  async getTask(options: {
    projectId: string
    taskId: string
  }): Promise<unknown> {
    return this.request(
      `project/${encodeURIComponent(options.projectId)}/task/${encodeURIComponent(options.taskId)}`
    )
  }

  /**
   * Creates a task with the supplied title and scheduling fields.
   */
  async createTask(options: {
    projectId: string
    title: string
    content?: string
    dueDate?: string
    timeZone?: string
    priority?: number
  }): Promise<unknown> {
    return this.request('task', 'POST', options)
  }

  /**
   * Updates only fields supplied by the caller.
   */
  async updateTask(options: {
    projectId: string
    taskId: string
    title?: string
    content?: string
    dueDate?: string
    timeZone?: string
    priority?: number
  }): Promise<unknown> {
    const { taskId, ...fields } = options

    return this.request(`task/${encodeURIComponent(taskId)}`, 'POST', {
      ...fields,
      id: taskId
    })
  }

  /**
   * Marks the selected task complete.
   */
  async completeTask(options: {
    projectId: string
    taskId: string
  }): Promise<unknown> {
    return this.request(
      `project/${encodeURIComponent(options.projectId)}/task/${encodeURIComponent(options.taskId)}/complete`,
      'POST'
    )
  }

  /**
   * Verifies this account using a read-only provider request.
   */
  public override async validateConnection(): Promise<{
    account_label?: string
  }> {
    await this.listProjects()

    return {}
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
      throw new Error(`TickTick request failed (${response.status}).`)
    }

    const text = await response.text()

    return text ? (JSON.parse(text) as unknown) : { success: true }
  }
}

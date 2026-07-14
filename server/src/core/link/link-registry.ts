import { randomUUID } from 'node:crypto'

import type {
  LinkDescriptor,
  LinkToolkitDefinition,
  LinkToolInvocation,
  LinkToolProgressPayload,
  LinkToolResultPayload
} from '@/core/link/types'
import { LINK_EVENTS } from '@/core/link/types'
import type {
  ToolExecutionInput,
  ToolExecutionResult,
  ToolRuntimeProgress
} from '@/core/tool-executor'

const LINK_TOOL_TIMEOUT_MS = 15 * 60 * 1_000

export interface LinkTransport {
  emit: (eventName: string, payload: unknown) => void
}

export interface LinkConnection {
  profileName: string
  device: LinkDescriptor
  toolkits: LinkToolkitDefinition[]
  transport: LinkTransport
}

interface PendingInvocation {
  profileName: string
  deviceId: string
  resolve: (result: ToolExecutionResult) => void
  reject: (error: Error) => void
  onProgress?: (progress: ToolRuntimeProgress) => void
  timeout: NodeJS.Timeout
}

class LinkRegistry {
  private readonly connections = new Map<string, LinkConnection>()
  private readonly pendingInvocations = new Map<string, PendingInvocation>()

  public register(input: LinkConnection): void {
    this.connections.set(
      this.getConnectionKey(input.profileName, input.device.id),
      input
    )
  }

  public unregister(profileName: string, deviceId: string): void {
    this.connections.delete(this.getConnectionKey(profileName, deviceId))

    for (const [invocationId, pending] of this.pendingInvocations.entries()) {
      if (pending.profileName !== profileName || pending.deviceId !== deviceId) {
        continue
      }

      clearTimeout(pending.timeout)
      pending.reject(new Error(`Link "${deviceId}" disconnected.`))
      this.pendingInvocations.delete(invocationId)
    }
  }

  public getConnection(
    profileName: string,
    deviceId: string
  ): LinkConnection | null {
    return (
      this.connections.get(this.getConnectionKey(profileName, deviceId)) ||
      null
    )
  }

  public async invokeTool(input: {
    profileName: string
    deviceId: string
    toolInput: ToolExecutionInput
    onProgress?: (progress: ToolRuntimeProgress) => void
  }): Promise<ToolExecutionResult> {
    const connection = this.getConnection(input.profileName, input.deviceId)

    if (!connection) {
      throw new Error(`Link "${input.deviceId}" is offline.`)
    }

    const invocationId = randomUUID()
    const invocation: LinkToolInvocation = {
      invocationId,
      input: input.toolInput
    }

    return new Promise<ToolExecutionResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingInvocations.delete(invocationId)
        reject(new Error(`Link tool call timed out on "${input.deviceId}".`))
      }, LINK_TOOL_TIMEOUT_MS)

      timeout.unref?.()
      this.pendingInvocations.set(invocationId, {
        profileName: input.profileName,
        deviceId: input.deviceId,
        resolve,
        reject,
        ...(input.onProgress ? { onProgress: input.onProgress } : {}),
        timeout
      })
      connection.transport.emit(LINK_EVENTS.invokeTool, invocation)
    })
  }

  public handleProgress(
    profileName: string,
    deviceId: string,
    payload: LinkToolProgressPayload
  ): void {
    const pending = this.pendingInvocations.get(payload.invocationId)

    if (
      !pending ||
      pending.profileName !== profileName ||
      pending.deviceId !== deviceId
    ) {
      return
    }

    pending.onProgress?.(payload.progress)
  }

  public handleResult(
    profileName: string,
    deviceId: string,
    payload: LinkToolResultPayload
  ): void {
    const pending = this.pendingInvocations.get(payload.invocationId)

    if (
      !pending ||
      pending.profileName !== profileName ||
      pending.deviceId !== deviceId
    ) {
      return
    }

    clearTimeout(pending.timeout)
    this.pendingInvocations.delete(payload.invocationId)
    pending.resolve(payload.result)
  }

  private getConnectionKey(profileName: string, deviceId: string): string {
    return `${profileName}:${deviceId}`
  }
}

export const LINK_REGISTRY = new LinkRegistry()

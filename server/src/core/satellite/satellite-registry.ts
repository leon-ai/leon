import { randomUUID } from 'node:crypto'

import type {
  SatelliteDescriptor,
  SatelliteToolkitDefinition,
  SatelliteToolInvocation,
  SatelliteToolProgressPayload,
  SatelliteToolResultPayload
} from '@/core/satellite/types'
import { SATELLITE_EVENTS } from '@/core/satellite/types'
import type {
  ToolExecutionInput,
  ToolExecutionResult,
  ToolRuntimeProgress
} from '@/core/tool-executor'
import { runWithProfileContext } from '@/core/profile-runtime/profile-context'

const SATELLITE_TOOL_TIMEOUT_MS = 15 * 60 * 1_000

export interface SatelliteTransport {
  emit: (eventName: string, payload: unknown) => void
}

export interface SatelliteConnection {
  profileName: string
  device: SatelliteDescriptor
  toolkits: SatelliteToolkitDefinition[]
  transport: SatelliteTransport
}

interface PendingInvocation {
  profileName: string
  deviceId: string
  resolve: (result: ToolExecutionResult) => void
  reject: (error: Error) => void
  onProgress?: (progress: ToolRuntimeProgress) => void
  timeout: NodeJS.Timeout
}

class SatelliteRegistry {
  private readonly connections = new Map<string, SatelliteConnection>()
  private readonly pendingInvocations = new Map<string, PendingInvocation>()

  public register(input: SatelliteConnection): void {
    this.connections.set(
      this.getConnectionKey(input.profileName, input.device.id),
      input
    )
  }

  public unregister(
    profileName: string,
    deviceId: string,
    transport?: SatelliteTransport
  ): boolean {
    const connectionKey = this.getConnectionKey(profileName, deviceId)
    const connection = this.connections.get(connectionKey)

    // A reconnect replaces the transport for the same device. Ignore a later
    // disconnect from the superseded socket so it cannot remove the new one.
    if (transport && connection?.transport !== transport) {
      return false
    }

    if (!this.connections.delete(connectionKey)) {
      return false
    }

    for (const [invocationId, pending] of this.pendingInvocations.entries()) {
      if (pending.profileName !== profileName || pending.deviceId !== deviceId) {
        continue
      }

      clearTimeout(pending.timeout)
      pending.reject(new Error(`Satellite "${deviceId}" disconnected.`))
      this.pendingInvocations.delete(invocationId)
    }

    return true
  }

  public getConnection(
    profileName: string,
    deviceId: string
  ): SatelliteConnection | null {
    return (
      this.connections.get(this.getConnectionKey(profileName, deviceId)) ||
      null
    )
  }

  public async invokeTool(input: {
    profileName: string
    deviceId: string
    conversationSessionId?: string | null
    toolInput: ToolExecutionInput
    onProgress?: (progress: ToolRuntimeProgress) => void
  }): Promise<ToolExecutionResult> {
    const connection = this.getConnection(input.profileName, input.deviceId)

    if (!connection) {
      throw new Error(`Satellite "${input.deviceId}" is offline.`)
    }

    const invocationId = randomUUID()
    const invocation: SatelliteToolInvocation = {
      invocationId,
      input: input.toolInput,
      ...(input.conversationSessionId
        ? { conversationSessionId: input.conversationSessionId }
        : {})
    }

    return new Promise<ToolExecutionResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingInvocations.delete(invocationId)
        reject(
          new Error(`Satellite tool call timed out on "${input.deviceId}".`)
        )
      }, SATELLITE_TOOL_TIMEOUT_MS)

      timeout.unref?.()
      this.pendingInvocations.set(invocationId, {
        profileName: input.profileName,
        deviceId: input.deviceId,
        resolve,
        reject,
        ...(input.onProgress ? { onProgress: input.onProgress } : {}),
        timeout
      })
      connection.transport.emit(SATELLITE_EVENTS.invokeTool, invocation)
    })
  }

  public handleProgress(
    profileName: string,
    deviceId: string,
    payload: SatelliteToolProgressPayload
  ): void {
    const pending = this.pendingInvocations.get(payload.invocationId)

    if (
      !pending ||
      pending.profileName !== profileName ||
      pending.deviceId !== deviceId
    ) {
      return
    }

    // Socket events run outside the invocation's request scope. Restore the
    // profile so downstream progress stays isolated to the correct owner.
    runWithProfileContext({ profileName: pending.profileName }, () => {
      pending.onProgress?.(payload.progress)
    })
  }

  public handleResult(
    profileName: string,
    deviceId: string,
    payload: SatelliteToolResultPayload
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

export const SATELLITE_REGISTRY = new SatelliteRegistry()

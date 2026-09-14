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
import { getSatelliteArtifactRoot, receiveSatelliteArtifacts } from '@/core/satellite/satellite-artifacts'
import { parseSatelliteContext, SATELLITE_CONTEXT_MAX_AGE_MS, type SatelliteContextSnapshot } from '@/core/satellite/satellite-context'

const SATELLITE_TOOL_TIMEOUT_MS = 15 * 60 * 1_000

export interface SatelliteTransport {
  emit: (eventName: string, payload: unknown) => void
}

export interface SatelliteConnection {
  profileName: string
  device: SatelliteDescriptor
  toolkits: SatelliteToolkitDefinition[]
  transport: SatelliteTransport
  context?: { receivedAt: number, snapshot: SatelliteContextSnapshot }
}

interface PendingInvocation {
  profileName: string
  deviceId: string
  resolve: (result: ToolExecutionResult) => void
  reject: (error: Error) => void
  onProgress?: (progress: ToolRuntimeProgress) => void
  timeout: NodeJS.Timeout
  transport: SatelliteTransport
  removeAbortListener: () => void
  conversationSessionId?: string
  receivingResult?: boolean
}

class SatelliteRegistry {
  private readonly connections = new Map<string, SatelliteConnection>()
  private readonly pendingInvocations = new Map<string, PendingInvocation>()

  /**
   * Context inherits the authenticated socket's owner and device, never payload IDs.
   */
  public updateContext(profileName: string, deviceId: string, payload: unknown, transport: SatelliteTransport): void {
    const connection = this.getConnection(profileName, deviceId)
    if (!connection || connection.transport !== transport) return
    const snapshot = parseSatelliteContext(payload)
    if (snapshot) connection.context = { receivedAt: Date.now(), snapshot }
  }

  /**
   * Missing, expired and disconnected snapshots stay unavailable, not server-local.
   */
  public getContext(profileName: string, deviceId: string): SatelliteContextSnapshot | null {
    const context = this.getConnection(profileName, deviceId)?.context
    return context && Date.now() - context.receivedAt < SATELLITE_CONTEXT_MAX_AGE_MS
      ? context.snapshot : null
  }

  public register(input: SatelliteConnection): void {
    // Reconnection does not transfer in-flight native actions to a new process.
    this.unregister(input.profileName, input.device.id)
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

      this.cancelInvocation(invocationId, new Error(`Satellite "${deviceId}" disconnected.`))
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
    signal?: AbortSignal
  }): Promise<ToolExecutionResult> {
    input.signal?.throwIfAborted()
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
      const timeout = setTimeout(() => this.cancelInvocation(invocationId,
        new Error(`Satellite tool call timed out on "${input.deviceId}".`)
      ), SATELLITE_TOOL_TIMEOUT_MS)
      const onAbort = (): void => this.cancelInvocation(invocationId,
        new Error('Satellite tool call canceled; already-delivered input may have executed.')
      )

      timeout.unref?.()
      this.pendingInvocations.set(invocationId, {
        profileName: input.profileName,
        deviceId: input.deviceId,
        resolve,
        reject,
        ...(input.onProgress ? { onProgress: input.onProgress } : {}),
        timeout,
        transport: connection.transport,
        ...(input.conversationSessionId ? { conversationSessionId: input.conversationSessionId } : {}),
        removeAbortListener: () => input.signal?.removeEventListener('abort', onAbort)
      })
      input.signal?.addEventListener('abort', onAbort, { once: true })
      try {
        connection.transport.emit(SATELLITE_EVENTS.invokeTool, invocation)
      } catch (error) {
        this.cancelInvocation(invocationId, error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  public handleProgress(
    profileName: string,
    deviceId: string,
    payload: SatelliteToolProgressPayload,
    transport?: SatelliteTransport
  ): void {
    const pending = this.pendingInvocations.get(payload.invocationId)

    if (
      !pending ||
      pending.profileName !== profileName ||
      pending.deviceId !== deviceId ||
      (transport && pending.transport !== transport)
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
    payload: SatelliteToolResultPayload,
    transport?: SatelliteTransport
  ): void {
    const pending = this.pendingInvocations.get(payload.invocationId)

    if (
      !pending ||
      pending.receivingResult ||
      pending.profileName !== profileName ||
      pending.deviceId !== deviceId ||
      (transport && pending.transport !== transport)
    ) {
      return
    }

    pending.receivingResult = true
    const receive = async (): Promise<ToolExecutionResult> => {
      if (!payload.artifacts) return payload.result
      if (!pending.conversationSessionId) throw new Error('Satellite artifacts require a conversation session.')
      return receiveSatelliteArtifacts(
        getSatelliteArtifactRoot(pending.profileName, pending.conversationSessionId),
        payload.result, payload.artifacts
      )
    }
    void receive().then((result) => {
      // Cancellation or replacement can win while files are being saved.
      if (this.pendingInvocations.get(payload.invocationId) !== pending) return
      clearTimeout(pending.timeout)
      pending.removeAbortListener()
      this.pendingInvocations.delete(payload.invocationId)
      pending.resolve(result)
    }).catch((error: unknown) => {
      this.cancelInvocation(payload.invocationId, new Error(
        `Satellite artifact transfer failed; the action may have executed, do not replay it blindly: ${String(error)}`
      ))
    })
  }

  private getConnectionKey(profileName: string, deviceId: string): string {
    return `${profileName}:${deviceId}`
  }

  private cancelInvocation(invocationId: string, error: Error): void {
    const pending = this.pendingInvocations.get(invocationId)
    if (!pending) return
    this.pendingInvocations.delete(invocationId)
    clearTimeout(pending.timeout)
    pending.removeAbortListener()
    try {
      pending.transport.emit(SATELLITE_EVENTS.cancelTool, { invocationId })
    } catch {
      // The disconnected device also aborts its workers; local rejection must complete.
    }
    pending.reject(error)
  }
}

export const SATELLITE_REGISTRY = new SatelliteRegistry()

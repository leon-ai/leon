import os from 'node:os'

import { io } from 'socket.io-client'

import {
  TOOLKIT_REGISTRY,
  TOOL_EXECUTOR,
  CONTEXT_MANAGER,
  TOOL_WORKER_MANAGER
} from '@/core'
import {
  SATELLITE_EVENTS,
  SATELLITE_PROTOCOL_VERSION,
  SATELLITE_MAX_MESSAGE_BYTES,
  type SatelliteErrorPayload,
  type SatelliteToolInvocation,
  type SatelliteToolCancellation,
  type SatelliteArtifactBundle,
  type SatelliteToolResultPayload
} from '@/core/satellite/types'
import {
  parseProfileCredential,
  readStoredProfileToken
} from '@/core/profile-auth'
import { runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { runWithConversationSession } from '@/core/session-manager/session-context'
import { LEON_PROFILE_NAME } from '@/leon-roots'
import { LogHelper } from '@/helpers/log-helper'
import type { ToolExecutionResult } from '@/core/tool-executor'
import { buildSatelliteProcessTitle } from '@/core/satellite/satellite-process-title'
import { collectSatelliteArtifacts, getSatelliteArtifactRoot } from '@/core/satellite/satellite-artifacts'
import { SATELLITE_CONTEXT_REFRESH_MS } from '@/core/satellite/satellite-context'

const REMOTE_URL_ARGUMENT = '--url'
const PROFILE_TOKEN_ARGUMENT = '--token'
const DEVICE_ID_ARGUMENT = '--device-id'
const DEFAULT_SATELLITE_NAME = 'Leon Satellite'
const activeInvocations = new Map<string, AbortController>()

function buildSatelliteToolError(
  invocation: SatelliteToolInvocation,
  error: unknown
): ToolExecutionResult {
  return {
    status: 'error',
    message: error instanceof Error ? error.message : String(error),
    data: {
      tool_id: invocation.input.toolId,
      toolkit_id: invocation.input.toolkitId || null,
      function_name: invocation.input.functionName || null,
      input: invocation.input.toolInput || null,
      parsed_input: invocation.input.parsedInput || null,
      output: {}
    }
  }
}

function getArgumentValue(argumentName: string): string {
  const argumentIndex = process.argv.indexOf(argumentName)

  return argumentIndex >= 0
    ? String(process.argv[argumentIndex + 1] || '').trim()
    : ''
}

function getProfileCredential(): string {
  const explicitCredential =
    getArgumentValue(PROFILE_TOKEN_ARGUMENT) ||
    String(process.env['LEON_SATELLITE_PROFILE_TOKEN'] || '').trim()

  if (explicitCredential) {
    return explicitCredential
  }

  const localToken = readStoredProfileToken(LEON_PROFILE_NAME)

  return localToken ? `${LEON_PROFILE_NAME}:${localToken}` : ''
}

async function startSatellite(): Promise<void> {
  const remoteURL =
    getArgumentValue(REMOTE_URL_ARGUMENT) ||
    String(process.env['LEON_SATELLITE_REMOTE_URL'] || '').trim()
  const credentialValue = getProfileCredential()
  const credential = parseProfileCredential(credentialValue)

  if (!remoteURL) {
    throw new Error(
      `A remote Leon URL is required through ${REMOTE_URL_ARGUMENT} or LEON_SATELLITE_REMOTE_URL.`
    )
  }
  if (!credential) {
    throw new Error(
      `A profile token is required through ${PROFILE_TOKEN_ARGUMENT}, LEON_SATELLITE_PROFILE_TOKEN, or the active local profile.`
    )
  }

  const deviceId =
    getArgumentValue(DEVICE_ID_ARGUMENT) ||
    String(process.env['LEON_SATELLITE_DEVICE_ID'] || '').trim() ||
    os.hostname()

  process.title = buildSatelliteProcessTitle(
    credential.profileName,
    deviceId
  )

  await runWithProfileContext(
    { profileName: credential.profileName },
    async () => {
      await TOOLKIT_REGISTRY.load()
    }
  )

  const socket = io(remoteURL, {
    auth: {
      token: credential.value
    },
    reconnection: true
  })

  let refreshingContext = false
  const publishContext = async (): Promise<void> => {
    if (!socket.connected || refreshingContext) return
    refreshingContext = true
    const connectionId = socket.id
    try {
      await runWithProfileContext({ profileName: credential.profileName }, async () => {
        const filenames = TOOLKIT_REGISTRY.getSatelliteManifest()
          .flatMap((toolkit) => toolkit.context_files || [])
        const snapshot = await CONTEXT_MANAGER.getDeviceDiscoverySnapshot(filenames)
        if (socket.connected && socket.id === connectionId) socket.emit(SATELLITE_EVENTS.context, snapshot)
      })
    } catch (error) {
      LogHelper.warning(`Device discovery context unavailable: ${String(error)}`)
    } finally {
      refreshingContext = false
    }
  }
  const contextTimer = setInterval(() => void publishContext(), SATELLITE_CONTEXT_REFRESH_MS)
  contextTimer.unref()

  socket.on(SATELLITE_EVENTS.cancelTool, ({ invocationId }: SatelliteToolCancellation) => {
    activeInvocations.get(invocationId)?.abort()
  })
  socket.on('disconnect', () => {
    // A reconnect must not resume desktop work whose caller has disconnected.
    for (const controller of activeInvocations.values()) controller.abort()
  })

  socket.on('connect', () => {
    void runWithProfileContext(
      { profileName: credential.profileName },
      async () => {
        socket.emit(SATELLITE_EVENTS.init, {
          protocolVersion: SATELLITE_PROTOCOL_VERSION,
          token: credential.value,
          device: {
            id: deviceId,
            name: DEFAULT_SATELLITE_NAME,
            platform: process.platform
          },
          toolkits: TOOLKIT_REGISTRY.getSatelliteManifest()
        })
      }
    )
  })

  socket.on(SATELLITE_EVENTS.ready, () => {
    void publishContext()
    LogHelper.title('Satellite')
    LogHelper.success(
      `Connected device ${deviceId} to profile ${credential.profileName}`
    )
  })

  socket.on(
    SATELLITE_EVENTS.invokeTool,
    async (invocation: SatelliteToolInvocation) => {
      if (activeInvocations.has(invocation.invocationId)) return
      const controller = new AbortController()
      activeInvocations.set(invocation.invocationId, controller)
      let result: ToolExecutionResult
      let artifacts: SatelliteArtifactBundle | undefined

      try {
        result = await runWithProfileContext(
          { profileName: credential.profileName },
          async () => {
            const execute = (): Promise<ToolExecutionResult> =>
              TOOL_EXECUTOR.executeTool({
                ...invocation.input,
                signal: controller.signal,
                onProgress: (progress) => {
                  socket.volatile.emit(SATELLITE_EVENTS.toolProgress, {
                    invocationId: invocation.invocationId,
                    progress
                  })
                }
              })

            return invocation.conversationSessionId
              ? runWithConversationSession(
                  { sessionId: invocation.conversationSessionId },
                  execute
                )
              : execute()
          }
        )
        if (invocation.conversationSessionId && !controller.signal.aborted) {
          artifacts = await collectSatelliteArtifacts(
            getSatelliteArtifactRoot(credential.profileName, invocation.conversationSessionId), result
          ).catch((error: unknown) => {
            throw new Error(`Satellite artifact transfer failed; the action may have executed, do not replay it blindly: ${String(error)}`)
          })
        }
      } catch (error) {
        result = buildSatelliteToolError(invocation, error)
      } finally {
        activeInvocations.delete(invocation.invocationId)
      }

      const payload: SatelliteToolResultPayload = {
        invocationId: invocation.invocationId,
        result,
        ...(artifacts ? { artifacts } : {})
      }

      if (Buffer.byteLength(JSON.stringify(payload)) > SATELLITE_MAX_MESSAGE_BYTES) {
        // Report the limit without dropping the connection or retrying the input.
        payload.result = buildSatelliteToolError(invocation,
          new Error('Satellite result exceeds the transport limit. The action may have executed; do not replay it blindly.'))
        delete payload.artifacts
      }

      if (socket.connected && !controller.signal.aborted) {
        socket.emit(SATELLITE_EVENTS.toolResult, payload)
      }
    }
  )

  socket.on(SATELLITE_EVENTS.error, (error: SatelliteErrorPayload) => {
    LogHelper.title('Satellite')
    LogHelper.error(error.message)
  })

  socket.on('connect_error', (error) => {
    LogHelper.title('Satellite')
    LogHelper.error(`Connection failed: ${error.message}`)
  })
}

process.title = 'leon-satellite'

let isShuttingDown = false

const shutDown = async (): Promise<void> => {
  if (isShuttingDown) {
    return
  }

  isShuttingDown = true
  for (const controller of activeInvocations.values()) controller.abort()
  await TOOL_WORKER_MANAGER.dispose()
  process.exit(0)
}

process.once('SIGINT', () => void shutDown())
process.once('SIGTERM', () => void shutDown())

void startSatellite().catch((error: unknown) => {
  LogHelper.title('Satellite')
  LogHelper.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

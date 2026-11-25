import { API_VERSION } from '@/constants'
import { uploadSatelliteDeliverables } from '@/core/satellite/satellite-deliverables'
import os from 'node:os'
import { once } from 'node:events'

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
} from '@/core/profile-runtime/profile-auth'
import { runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { runWithConversationSession } from '@/core/session-manager/session-context'
import { LEON_PROFILE_NAME } from '@/leon-roots'
import { LogHelper } from '@/helpers/log-helper'
import type { ToolExecutionResult } from '@/core/tool-manager/tool-executor'
import { buildSatelliteProcessTitle } from '@/core/satellite/satellite-process-title'
import { collectSatelliteArtifacts, getSatelliteArtifactRoot } from '@/core/satellite/satellite-artifacts'
import { SATELLITE_CONTEXT_REFRESH_MS } from '@/core/satellite/satellite-context'
import { runOnSatellite } from '@/core/satellite/device-context'
import {
  DESKTOP_SATELLITE_ENV,
  DESKTOP_SATELLITE_READY,
  DESKTOP_SATELLITE_REJECTED,
  type DeviceGrant
} from '@@/bridges/runtime/contracts/device-execution'

const REMOTE_URL_ARGUMENT = '--url'
const PROFILE_TOKEN_ARGUMENT = '--token'
const DEVICE_ID_ARGUMENT = '--device-id'
const DEFAULT_SATELLITE_NAME = 'Leon Satellite'
const activeInvocations = new Map<string, AbortController>()
const activePreparations = new Map<string, AbortController>()

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
  const grant = process.env[DESKTOP_SATELLITE_ENV] === '1' && process.send
    ? (await once(process, 'message'))[0] as DeviceGrant : undefined
  const deviceCredential = grant?.credential
  const credential = parseProfileCredential(deviceCredential || getProfileCredential())

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

  const deviceId = grant?.id ||
    getArgumentValue(DEVICE_ID_ARGUMENT) ||
    String(process.env['LEON_SATELLITE_DEVICE_ID'] || '').trim() ||
    os.hostname()

  // A remote profile name never selects another profile on the local computer.
  const localProfile = grant ? LEON_PROFILE_NAME : credential.profileName
  process.title = buildSatelliteProcessTitle(localProfile, deviceId)

  await runWithProfileContext(
    { profileName: localProfile },
    async () => {
      await TOOLKIT_REGISTRY.load()
    }
  )

  const manifest = runWithProfileContext({ profileName: localProfile }, () =>
    runOnSatellite(() => deviceCredential
      ? TOOLKIT_REGISTRY.getPairedDeviceManifest(grant?.tools)
      : TOOLKIT_REGISTRY.getSatelliteManifest())
  )
  const socket = io(remoteURL, {
    auth: deviceCredential ? {} : { token: credential.value },
    reconnection: true
  })

  let refreshingContext = false
  const publishContext = async (): Promise<void> => {
    if (deviceCredential || !socket.connected || refreshingContext) return
    refreshingContext = true
    const connectionId = socket.id
    try {
      await runWithProfileContext({ profileName: credential.profileName }, async () => {
        const filenames = runOnSatellite(() => TOOLKIT_REGISTRY.getSatelliteManifest())
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

  socket.on(SATELLITE_EVENTS.cancelTool, ({ invocationId, interruptOnly }: SatelliteToolCancellation) => {
    activeInvocations.get(invocationId)?.abort()
    if (!interruptOnly) {
      activePreparations.get(invocationId)?.abort()
    }
  })
  socket.on('disconnect', () => {
    // A reconnect must not resume desktop work whose caller has disconnected.
    for (const controller of activeInvocations.values()) controller.abort()
    for (const controller of activePreparations.values()) controller.abort()
  })

  socket.on('connect', () => {
    void runWithProfileContext(
      { profileName: localProfile },
      async () => {
        socket.emit(SATELLITE_EVENTS.init, {
          protocolVersion: SATELLITE_PROTOCOL_VERSION,
          ...(deviceCredential ? { deviceCredential } : { token: credential.value }),
          device: {
            id: deviceId,
            name: DEFAULT_SATELLITE_NAME,
            platform: process.platform
          },
          toolkits: deviceCredential ? manifest : runOnSatellite(() => TOOLKIT_REGISTRY.getSatelliteManifest())
        })
      }
    )
  })

  socket.on(SATELLITE_EVENTS.ready, () => {
    if (grant && process.connected) {
      process.send?.(DESKTOP_SATELLITE_READY)
    }
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
      const preparationController = new AbortController()
      activeInvocations.set(invocation.invocationId, controller)
      activePreparations.set(invocation.invocationId, preparationController)
      let result: ToolExecutionResult
      let artifacts: SatelliteArtifactBundle | undefined
      let timing: SatelliteToolResultPayload['timing']
      const startedAt = performance.now()

      try {
        if (deviceCredential && !manifest.some((toolkit) =>
          toolkit.id === invocation.input.toolkitId &&
          Boolean(invocation.input.functionName && Object.hasOwn(
            toolkit.tools[invocation.input.toolId]?.functions ?? {}, invocation.input.functionName
          ))
        )) {
          throw new Error('This tool function is outside the device grant.')
        }
        result = await runWithProfileContext(
          { profileName: localProfile },
          async () => {
            const execute = (): Promise<ToolExecutionResult> =>
              runOnSatellite(() => TOOL_EXECUTOR.executeTool({
                ...invocation.input,
                deferArtifactDelivery: true,
                ...(!deviceCredential ? { leonService: {
                  baseURL: `${remoteURL.replace(/\/$/, '')}/api/${API_VERSION}`,
                  token: credential.value
                } } : {}),
                signal: controller.signal,
                retainedSignal: preparationController.signal,
                onProgress: (progress) => {
                  const transport = progress.stream || progress.phase || progress.downloads?.length ? socket : socket.volatile
                  transport.emit(SATELLITE_EVENTS.toolProgress, {
                    invocationId: invocation.invocationId,
                    progress
                  })
                }
              }))

            return invocation.conversationSessionId
              ? runWithConversationSession(
                  { sessionId: invocation.conversationSessionId },
                  execute
                )
              : execute()
          }
        )
        const executedAt = performance.now()
        if (invocation.conversationSessionId && !controller.signal.aborted) {
          if (!deviceCredential) {
            result = await uploadSatelliteDeliverables({
              result,
              root: getSatelliteArtifactRoot(credential.profileName, invocation.conversationSessionId),
              sessionId: invocation.conversationSessionId,
              remoteURL,
              token: credential.value,
              signal: controller.signal
            })
          }
          artifacts = await collectSatelliteArtifacts(
            getSatelliteArtifactRoot(localProfile, invocation.conversationSessionId), result
          ).catch((error: unknown) => {
            throw new Error(`Satellite artifact transfer failed; the action may have executed, do not replay it blindly: ${String(error)}`)
          })
        }
        timing = { executionMs: executedAt - startedAt, artifactPreparationMs: performance.now() - executedAt }
      } catch (error) {
        result = buildSatelliteToolError(invocation, error)
      } finally {
        activeInvocations.delete(invocation.invocationId)
        activePreparations.delete(invocation.invocationId)
      }

      const payload: SatelliteToolResultPayload = {
        invocationId: invocation.invocationId,
        result,
        ...(timing ? { timing } : {}),
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
    if (grant && process.connected) {
      process.send?.(DESKTOP_SATELLITE_REJECTED)
      socket.disconnect()
    }
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
if (process.env[DESKTOP_SATELLITE_ENV] === '1') {
  process.once('disconnect', () => void shutDown())
}

void startSatellite().catch((error: unknown) => {
  LogHelper.title('Satellite')
  LogHelper.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

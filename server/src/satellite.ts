import os from 'node:os'

import { io } from 'socket.io-client'

import {
  TOOLKIT_REGISTRY,
  TOOL_EXECUTOR,
  TOOL_PROVIDER_REGISTRY
} from '@/core'
import {
  SATELLITE_EVENTS,
  SATELLITE_PROTOCOL_VERSION,
  type SatelliteErrorPayload,
  type SatelliteToolInvocation,
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

const REMOTE_URL_ARGUMENT = '--url'
const PROFILE_TOKEN_ARGUMENT = '--token'
const DEVICE_ID_ARGUMENT = '--device-id'
const DEFAULT_SATELLITE_NAME = 'Leon Satellite'

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
    LogHelper.title('Satellite')
    LogHelper.success(
      `Connected device ${deviceId} to profile ${credential.profileName}`
    )
  })

  socket.on(
    SATELLITE_EVENTS.invokeTool,
    async (invocation: SatelliteToolInvocation) => {
      let result: ToolExecutionResult

      try {
        result = await runWithProfileContext(
          { profileName: credential.profileName },
          async () => {
            const execute = (): Promise<ToolExecutionResult> =>
              TOOL_EXECUTOR.executeTool({
                ...invocation.input,
                onProgress: (progress) => {
                  socket.emit(SATELLITE_EVENTS.toolProgress, {
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
      } catch (error) {
        result = buildSatelliteToolError(invocation, error)
      }

      const payload: SatelliteToolResultPayload = {
        invocationId: invocation.invocationId,
        result
      }

      socket.emit(SATELLITE_EVENTS.toolResult, payload)
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
  await TOOL_PROVIDER_REGISTRY.dispose()
  process.exit(0)
}

process.once('SIGINT', () => void shutDown())
process.once('SIGTERM', () => void shutDown())

void startSatellite().catch((error: unknown) => {
  LogHelper.title('Satellite')
  LogHelper.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

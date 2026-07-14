import os from 'node:os'

import { io } from 'socket.io-client'

import { TOOLKIT_REGISTRY, TOOL_EXECUTOR } from '@/core'
import {
  LINK_EVENTS,
  LINK_PROTOCOL_VERSION,
  type LinkErrorPayload,
  type LinkToolInvocation,
  type LinkToolResultPayload
} from '@/core/link/types'
import {
  parseProfileCredential,
  readStoredProfileToken
} from '@/core/profile-auth'
import { runWithProfileContext } from '@/core/profile-runtime/profile-context'
import { LEON_PROFILE_NAME } from '@/leon-roots'
import { LogHelper } from '@/helpers/log-helper'
import type { ToolExecutionResult } from '@/core/tool-executor'

const REMOTE_URL_ARGUMENT = '--url'
const PROFILE_TOKEN_ARGUMENT = '--token'
const DEVICE_ID_ARGUMENT = '--device-id'
const DEFAULT_LINK_NAME = 'Leon Link'

function buildLinkToolError(
  invocation: LinkToolInvocation,
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
    String(process.env['LEON_LINK_PROFILE_TOKEN'] || '').trim()

  if (explicitCredential) {
    return explicitCredential
  }

  const localToken = readStoredProfileToken(LEON_PROFILE_NAME)

  return localToken ? `${LEON_PROFILE_NAME}:${localToken}` : ''
}

async function startLink(): Promise<void> {
  const remoteURL =
    getArgumentValue(REMOTE_URL_ARGUMENT) ||
    String(process.env['LEON_LINK_REMOTE_URL'] || '').trim()
  const credentialValue = getProfileCredential()
  const credential = parseProfileCredential(credentialValue)

  if (!remoteURL) {
    throw new Error(
      `A remote Leon URL is required through ${REMOTE_URL_ARGUMENT} or LEON_LINK_REMOTE_URL.`
    )
  }
  if (!credential) {
    throw new Error(
      `A profile token is required through ${PROFILE_TOKEN_ARGUMENT}, LEON_LINK_PROFILE_TOKEN, or the active local profile.`
    )
  }

  const deviceId =
    getArgumentValue(DEVICE_ID_ARGUMENT) ||
    String(process.env['LEON_LINK_DEVICE_ID'] || '').trim() ||
    os.hostname()

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
        socket.emit(LINK_EVENTS.init, {
          protocolVersion: LINK_PROTOCOL_VERSION,
          token: credential.value,
          device: {
            id: deviceId,
            name: DEFAULT_LINK_NAME,
            platform: process.platform
          },
          toolkits: TOOLKIT_REGISTRY.getLinkManifest()
        })
      }
    )
  })

  socket.on(LINK_EVENTS.ready, () => {
    LogHelper.title('Link')
    LogHelper.success(
      `Connected device ${deviceId} to profile ${credential.profileName}`
    )
  })

  socket.on(
    LINK_EVENTS.invokeTool,
    async (invocation: LinkToolInvocation) => {
      let result: ToolExecutionResult

      try {
        result = await runWithProfileContext(
          { profileName: credential.profileName },
          async () =>
            TOOL_EXECUTOR.executeTool({
              ...invocation.input,
              onProgress: (progress) => {
                socket.emit(LINK_EVENTS.toolProgress, {
                  invocationId: invocation.invocationId,
                  progress
                })
              }
            })
        )
      } catch (error) {
        result = buildLinkToolError(invocation, error)
      }

      const payload: LinkToolResultPayload = {
        invocationId: invocation.invocationId,
        result
      }

      socket.emit(LINK_EVENTS.toolResult, payload)
    }
  )

  socket.on(LINK_EVENTS.error, (error: LinkErrorPayload) => {
    LogHelper.title('Link')
    LogHelper.error(error.message)
  })

  socket.on('connect_error', (error) => {
    LogHelper.title('Link')
    LogHelper.error(`Connection failed: ${error.message}`)
  })
}

process.title = 'leon-link'

void startLink().catch((error: unknown) => {
  LogHelper.title('Link')
  LogHelper.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

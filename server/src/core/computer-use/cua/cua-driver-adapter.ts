import fs from 'node:fs'
import path from 'node:path'

import { CODEBASE_PATH } from '@/constants'

import {
  COMPUTER_USE_REMOTE_DRIVER_TIMEOUT_MS,
  COMPUTER_USE_REMOTE_DRIVER_TOKEN_ENV,
  COMPUTER_USE_REMOTE_DRIVER_URL_ENV,
  COMPUTER_USE_REMOTE_MODEL_FILES_FIELD,
  COMPUTER_USE_REMOTE_SESSION_AWARE_ACTIONS,
  CUA_TELEMETRY_ENABLED_ENV,
  CUA_X11_UINPUT_SAFETY_ENV
} from '../constants'
import { shouldUseCuaSafeX11Input } from '../computer-use-coordinate-mapper'
import type {
  ComputerUseDriver,
  CuaToolResult,
  RemoteComputerUseResponse
} from '../types'
import { asRecord, parseJsonRecord } from '../utils'

/** Adapts an owner-device host bridge to the computer-use driver contract. */
class RemoteCuaDriverAdapter implements ComputerUseDriver {
  // The host bridge exposes the same observation actions and image payloads.
  // Keep verification in this layer so remote agents also see action effects.
  public readonly supportsPostActionCapture = true

  public constructor(
    private readonly url: string,
    private readonly token: string
  ) {}

  public isAvailable(): boolean {
    return true
  }

  public async listToolsJson(): Promise<string> {
    const definitionPath = path.join(
      CODEBASE_PATH,
      'tools',
      'computer_use',
      'cua',
      'tool.json'
    )
    const definition = asRecord(
      JSON.parse(await fs.promises.readFile(definitionPath, 'utf8'))
    )
    const functions = asRecord(definition?.['functions']) || {}

    return JSON.stringify({
      tools: Object.entries(functions).map(([name, value]) => {
        const inputSchema = asRecord(asRecord(value)?.['parameters']) || {}
        if (!COMPUTER_USE_REMOTE_SESSION_AWARE_ACTIONS.has(name)) {
          return { name, inputSchema }
        }

        // The host owns session labels; expose them only to capability discovery.
        return {
          name,
          inputSchema: {
            ...inputSchema,
            properties: {
              ...(asRecord(inputSchema['properties']) || {}),
              session: { type: 'string' }
            }
          }
        }
      })
    })
  }

  public async callTool(
    name: string,
    argumentsJson: string
  ): Promise<CuaToolResult> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token
          ? { 'x-leon-http-plugin-token': this.token }
          : {})
      },
      body: JSON.stringify({
        action: name,
        arguments: parseJsonRecord(argumentsJson) || {}
      }),
      signal: AbortSignal.timeout(COMPUTER_USE_REMOTE_DRIVER_TIMEOUT_MS)
    })
    const payload = (await response.json()) as RemoteComputerUseResponse
    const output = asRecord(payload.output) || {}
    const modelFiles = Array.isArray(
      output[COMPUTER_USE_REMOTE_MODEL_FILES_FIELD]
    )
      ? output[COMPUTER_USE_REMOTE_MODEL_FILES_FIELD]
      : []
    const structuredOutput = { ...output }
    delete structuredOutput[COMPUTER_USE_REMOTE_MODEL_FILES_FIELD]
    const isError = !response.ok || payload.status !== 'ok'

    return {
      text: isError ? payload.error_message || 'Remote computer use failed.' : '',
      images: modelFiles.flatMap((value) => {
        const file = asRecord(value)
        const dataBase64 = file?.['data_base64']
        const mimeType = file?.['media_type']

        return typeof dataBase64 === 'string' && typeof mimeType === 'string'
          ? [{ dataBase64, mimeType }]
          : []
      }),
      structuredJson: JSON.stringify(structuredOutput),
      isError,
      ...(payload.error_code ? { errorCode: payload.error_code } : {}),
      degraded: output['degraded'] === true,
      rawJson: JSON.stringify(structuredOutput)
    }
  }

  public async shutdown(): Promise<void> {}

  public uniffiDestroy(): void {}
}

/** Creates the configured Cua adapter without exposing it to the provider. */
export async function createCuaDriverAdapter(): Promise<ComputerUseDriver> {
  const remoteUrl = process.env[COMPUTER_USE_REMOTE_DRIVER_URL_ENV]?.trim()
  if (remoteUrl) {
    return new RemoteCuaDriverAdapter(
      remoteUrl,
      process.env[COMPUTER_USE_REMOTE_DRIVER_TOKEN_ENV]?.trim() || ''
    )
  }

  process.env[CUA_TELEMETRY_ENABLED_ENV] ??= 'false'
  if (shouldUseCuaSafeX11Input(process.platform, process.env)) {
    // Cua currently keys its MPX/uinput crash guard to KDE; apply its XTEST
    // fallback to every local X11 session because the X server is shared.
    process.env[CUA_X11_UINPUT_SAFETY_ENV] = 'true'
  }
  const { CuaDriver } = await import('@trycua/cua-driver')
  return CuaDriver.create(undefined) as unknown as ComputerUseDriver
}

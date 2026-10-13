import { TOOLKIT_REGISTRY } from '@/core'
import type { OpenAITool, OpenAIToolCall } from '@/core/llm-manager/types'
import { saveConnection, saveOAuthApplicationSettings } from './connection-service'

export const CONNECTION_SETUP_TOOL_NAME = 'setup_connection'
const MAXIMUM_CREDENTIAL_LENGTH = 4_096

/**
 * Exposes the existing connection service without browser-specific machinery.
 */
export function createConnectionSetupTool(providers: string[]): OpenAITool | undefined {
  if (providers.length === 0) {
    return undefined
  }

  return {
    type: 'function',
    function: {
      name: CONNECTION_SETUP_TOOL_NAME,
      description: 'Submit credentials for connection setup requested by the owner. Use the provider, method and credential fields declared in connection setup facts. Tokens are verified and encrypted; OAuth application settings still require provider authorization. Never repeat credentials in messages or titles.',
      parameters: {
        type: 'object',
        properties: {
          provider: { type: 'string', enum: providers },
          method: { type: 'string', enum: ['api_key', 'oauth'] },
          credentials: {
            type: 'object',
            additionalProperties: { type: 'string' }
          }
        },
        required: ['provider', 'method', 'credentials'],
        additionalProperties: false
      }
    }
  }
}

/**
 * Removes all setup arguments before transcript persistence or model replay.
 */
export function redactConnectionSetupCall(call: OpenAIToolCall): OpenAIToolCall {
  if (call.function.name !== CONNECTION_SETUP_TOOL_NAME) {
    return call
  }

  return {
    ...call,
    function: { ...call.function, arguments: '{"credentials":"***"}' }
  }
}

/**
 * Validates declared fields and returns only a safe status, never provider errors.
 */
export async function setupConnection(input: Record<string, unknown>): Promise<string> {
  try {
    const { provider, method, credentials } = input
    if (
      typeof provider !== 'string' ||
      (method !== 'api_key' && method !== 'oauth') ||
      !credentials || typeof credentials !== 'object' || Array.isArray(credentials)
    ) {
      return 'Provide the connection provider, method and declared credential fields.'
    }

    const tool = TOOLKIT_REGISTRY.getConnectionTool(provider)
    const definition = tool.connection.methods[method]
    if (!definition) {
      return 'This tool does not support the requested connection method.'
    }

    const submitted = credentials as Record<string, unknown>
    const values = Object.fromEntries(Object.entries(definition.settings).map(([key, fallback]) => {
      const value = submitted[key] ?? fallback ?? ''
      if (
        typeof value !== 'string' || value.length > MAXIMUM_CREDENTIAL_LENGTH ||
        (fallback === null && !value.trim())
      ) {
        throw new Error('Invalid connection fields')
      }

      return [key, value.trim()]
    }))

    if (method === 'oauth') {
      await saveOAuthApplicationSettings(provider, values)
      return 'Application settings saved encrypted. Refresh the connection card and authorize the account with the provider; the account is not connected yet.'
    }

    await saveConnection({ provider, auth_type: method, credentials: values })
    return 'Connection verified and saved encrypted. Continue the original request.'
  } catch {
    return 'Connection setup failed. Check the declared credentials and permissions, or use the manual connection form.'
  }
}

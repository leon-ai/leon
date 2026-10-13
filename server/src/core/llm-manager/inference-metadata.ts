import { createHash } from 'node:crypto'

import { StringHelper } from '@/helpers/string-helper'

const CONNECTION_REFERENCE_LENGTH = 12
const REDACTED = '[REDACTED]'

export enum InferenceAuthMode {
  APIKey = 'api_key',
  ChatGPTOAuth = 'chatgpt_oauth',
  ClaudeSubscription = 'claude_subscription',
  None = 'none'
}

export enum InferenceCredentialSource {
  AccountBinding = 'account_binding',
  ProfileAPIKey = 'profile_api_key',
  None = 'none'
}

/**
 * Non-secret attribution for an inference request dispatched during a turn.
 */
export interface InferenceMetadata {
  provider: string
  model: string
  authMode: InferenceAuthMode
  credentialSource: InferenceCredentialSource
  connectionRef?: string
  endpoint: string | null
}

export type TurnInference = InferenceMetadata | InferenceMetadata[] | null

/**
 * Keeps account identifiers and URL credentials out of persisted attribution.
 */
export function createInferenceMetadata(
  input: Omit<InferenceMetadata, 'connectionRef'> & {
    connectionId?: string
    privateValues?: string[]
  }
): InferenceMetadata {
  let endpoint: string | null = null

  if (input.endpoint) {
    try {
      const url = new URL(input.endpoint)
      // User info, query parameters and fragments can contain credentials.
      endpoint = StringHelper.redactSecrets(`${url.origin}${url.pathname}`)

      // Custom proxy paths can also embed the selected credential or account ID.
      for (const value of [input.connectionId, ...input.privateValues || []]) {
        if (value) {
          endpoint = endpoint.split(value).join(REDACTED)
          endpoint = endpoint.split(encodeURIComponent(value)).join(REDACTED)
        }
      }
    } catch {
      // Diagnostics must never prevent inference or persist an unparsed URL.
      endpoint = null
    }
  }

  return {
    provider: input.provider,
    model: input.model,
    authMode: input.authMode,
    credentialSource: input.credentialSource,
    ...(input.connectionId
      ? {
          connectionRef: createHash('sha256')
            .update(input.connectionId)
            .digest('hex')
            .slice(0, CONNECTION_REFERENCE_LENGTH)
        }
      : {}),
    endpoint
  }
}

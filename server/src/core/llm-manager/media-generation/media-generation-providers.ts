import fs from 'node:fs/promises'
import {
  InferenceClient,
  type InferenceProviderOrPolicy
} from '@huggingface/inference'

import { CONFIG_MANAGER } from '@/config'
import { resolveProviderConnection } from '../provider-requests'
import { LLMProviders } from '@/core/llm-manager/types'
import {
  MediaKind,
  type GeneratedFile,
  type ResolvedMediaGenerationInput
} from './media-generation-types'
import {
  downloadGeneratedFile,
  mediaEndpoint,
  providerRequest
} from './media-generation-transport'
import { generateHostedDocument } from './media-generation-hosted-documents'

interface ProviderResult {
  files: GeneratedFile[]
}

function checkMiniMax(result: { base_resp?: { status_code: number } }): void {
  if (result.base_resp?.status_code) {
    throw new Error(
      `MiniMax rejected generation (${result.base_resp.status_code}).`
    )
  }
}

/**
 * Dispatches dedicated generation endpoints without changing the reasoning model.
 */
export async function generateWithProvider(
  input: ResolvedMediaGenerationInput
): Promise<ProviderResult> {
  const { provider, kind, model, prompt, signal } = input
  const options = input.options || {}
  const references = []

  if (input.reference_artifact_ids?.length) {
    if (
      kind !== MediaKind.Image ||
      ![LLMProviders.OpenAI, LLMProviders.OpenRouter].includes(provider)
    ) {
      throw new Error(
        'Artifact image references require an OpenAI or OpenRouter image model.'
      )
    }

    const { readArtifact } = await import('@/core/artifacts/artifact-store')

    for (const id of input.reference_artifact_ids) {
      const file = await readArtifact(input.session_id, id)

      if (
        !['image/png', 'image/jpeg', 'image/webp'].includes(
          file.artifact.mime_type
        )
      ) {
        throw new Error('Reference artifact must be an image.')
      }

      references.push({
        artifact: file.artifact,
        data: await fs.readFile(file.path)
      })
    }
  }

  if (kind === MediaKind.Document) {
    return { files: await generateHostedDocument(input) }
  }

  if (provider === LLMProviders.HuggingFace) {
    const connection = await resolveProviderConnection(provider)
    const client = new InferenceClient(connection.apiKey)
    const { inference_provider, ...parameters } = options
    const endpointUrl = CONFIG_MANAGER.getProviderGenerationBaseURL(provider)
    const args = {
      model,
      inputs: prompt,
      parameters,
      ...(typeof inference_provider === 'string'
        ? { provider: inference_provider as InferenceProviderOrPolicy }
        : {}),
      ...(endpointUrl ? { endpointUrl } : {})
    }
    const requestOptions = signal ? { signal } : {}
    const blob = await client.textToImage(args, {
      outputType: 'blob',
      ...requestOptions
    })
    const extension = 'png'

    return {
      files: [
        {
          data: new Uint8Array(await blob.arrayBuffer()),
          mime_type: blob.type || `${kind}/${extension}`,
          filename: input.filename || `generated.${extension}`
        }
      ]
    }
  }

  // Keep payload format and dispatch bound to the same selected connection.
  const imageConnection = await mediaEndpoint(provider)
  const subscriptionImage = provider === LLMProviders.OpenAI &&
    Boolean(imageConnection.accountId)

  if (provider === LLMProviders.OpenAI && options['mode'] === 'hosted') {
    const { image_model, ...imageOptions } = options

    delete imageOptions['mode']
    const providerResponse = await providerRequest(
      provider,
      '/responses',
      {
        model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              ...references.map((file) => ({
                type: 'input_image',
                image_url: `data:${file.artifact.mime_type};base64,${file.data.toString('base64')}`
              }))
            ]
          }
        ],
        tool_choice: { type: 'image_generation' },
        tools: [
          {
            type: 'image_generation',
            ...imageOptions,
            ...(image_model ? { model: image_model } : {})
          }
        ]
      },
      signal,
      imageConnection
    )
    const response = (await providerResponse.json()) as {
      output?: Array<{ type: string, result?: string }>
    }
    const images = (response.output || []).filter(
      (part) =>
        part.type === 'image_generation_call' && typeof part.result === 'string'
    )
    const format = String(imageOptions['output_format'] || 'png')

    return {
      files: images.map((image, index) => ({
        data: Buffer.from(image.result!, 'base64'),
        mime_type: `image/${format}`,
        filename: input.filename || `image-${index + 1}.${format}`
      }))
    }
  }

  if (provider === LLMProviders.OpenRouter) {
    // Chat image models return mixed text/images, unlike the Images API shape.
    const providerResponse = await providerRequest(
      provider,
      '/chat/completions',
      {
        ...options,
        model,
        messages: [
          {
            role: 'user',
            content: references.length
              ? [
                  { type: 'text', text: prompt },
                  ...references.map((file) => ({
                    type: 'image_url',
                    image_url: {
                      url: `data:${file.artifact.mime_type};base64,${file.data.toString('base64')}`
                    }
                  }))
                ]
              : prompt
          }
        ],
        modalities: ['image', 'text'],
        stream: false
      },
      signal
    )
    const response = (await providerResponse.json()) as {
      choices?: Array<{
        message?: { images?: Array<{ image_url: { url: string } }> }
      }>
    }
    const images = response.choices?.[0]?.message?.images || []

    return {
      files: await Promise.all(
        images.map(async (image, index) => {
          const url = image.image_url.url

          if (url.startsWith('data:')) {
            const comma = url.indexOf(',')
            const mime = url.slice(5, url.indexOf(';'))

            return {
              data: Buffer.from(url.slice(comma + 1), 'base64'),
              mime_type: mime,
              filename:
                input.filename ||
                `image-${index + 1}.${mime.split('/')[1] || 'png'}`
            }
          }

          return {
            data: await downloadGeneratedFile(url, signal),
            mime_type: 'image/png',
            filename: input.filename || `image-${index + 1}.png`
          }
        })
      )
    }
  }

  let imageBody: unknown = {
    ...(subscriptionImage ? { n: 1, quality: 'auto', size: 'auto', background: 'opaque' } : {}),
    ...options,
    model,
    prompt,
    ...(provider === LLMProviders.MiniMax ? { response_format: 'base64' } : {})
  }
  let imageEndpoint =
    provider === LLMProviders.MiniMax
      ? '/image_generation'
      : '/images/generations'

  if (references.length && subscriptionImage) {
    // The Codex Images endpoint accepts JSON image URLs rather than multipart files.
    imageBody = {
      ...(imageBody as Record<string, unknown>),
      images: references.map((file) => ({
        image_url: `data:${file.artifact.mime_type};base64,${file.data.toString('base64')}`
      }))
    }
    imageEndpoint = '/images/edits'
  } else if (references.length) {
    const form = new FormData()

    form.set('model', model)
    form.set('prompt', prompt)
    for (const [key, value] of Object.entries(options)) {
      form.set(key, typeof value === 'string' ? value : JSON.stringify(value))
    }

    for (const file of references) {
      form.append(
        'image[]',
        new Blob([file.data], { type: file.artifact.mime_type }),
        file.artifact.filename
      )
    }

    imageBody = form
    imageEndpoint = '/images/edits'
  }

  const providerResponse = await providerRequest(
    provider,
    imageEndpoint,
    imageBody,
    signal,
    imageConnection
  )
  const response = (await providerResponse.json()) as {
    data?:
      | Array<{ b64_json?: string, url?: string }>
      | { image_base64?: string[] }
    base_resp?: { status_code: number }
    output_format?: string
  }

  checkMiniMax(response)
  const images: Array<{ b64_json?: string, url?: string }> = Array.isArray(
    response.data
  )
    ? response.data
    : response.data?.image_base64?.map((b64_json) => ({ b64_json })) || []
  const format = response.output_format || String(options['output_format'] || 'png')

  return {
    files: await Promise.all(
      images.map(async (image, index) => ({
        data: image.b64_json
          ? Buffer.from(image.b64_json, 'base64')
          : await downloadGeneratedFile(image.url || '', signal),
        mime_type: `image/${format}`,
        filename:
          input.filename ||
          `image-${index + 1}.${format}`
      }))
    )
  }
}

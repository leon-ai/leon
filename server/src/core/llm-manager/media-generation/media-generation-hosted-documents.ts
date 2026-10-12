import path from 'node:path'
import { LLMProviders } from '@/core/llm-manager/types'
import { providerRequest, readMediaBytes } from './media-generation-transport'
import type { GeneratedFile, ResolvedMediaGenerationInput } from './media-generation-types'

const MAX_CONTINUATIONS = 12
const DOCUMENT_FORMATS = ['pdf', 'docx', 'xlsx', 'pptx']
const DOCUMENT_MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
}

function records(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.flatMap(records)
  }

  if (!value || typeof value !== 'object') {
    return []
  }

  const record = value as Record<string, unknown>

  return [record, ...Object.values(record).flatMap(records)]
}

/**
 * Materializes hosted execution files before provider containers expire.
 */
export async function generateHostedDocument(
  input: ResolvedMediaGenerationInput
): Promise<GeneratedFile[]> {
  const format = String(input.options?.['format'] || 'pdf')

  if (!DOCUMENT_FORMATS.includes(format)) {
    throw new Error('Unsupported hosted document format.')
  }

  if (input.provider === LLMProviders.Anthropic) {
    const messages: Array<Record<string, unknown>> = [
      { role: 'user', content: input.prompt }
    ]
    let container: unknown = {
      skills: [{ type: 'anthropic', skill_id: format, version: 'latest' }]
    }

    for (let step = 0; step < MAX_CONTINUATIONS; step++) {
      const providerResponse = await providerRequest(
        input.provider,
        '/messages',
        {
          model: input.model,
          max_tokens: 16_000,
          container,
          messages,
          tools: [{ type: 'code_execution_20260521', name: 'code_execution' }]
        },
        input.signal
      )
      const response = (await providerResponse.json()) as Record<
        string,
        unknown
      >

      messages.push({ role: 'assistant', content: response['content'] })
      const returnedContainer = response['container'] as
        | { id?: string }
        | undefined

      if (returnedContainer?.id) {
        container = {
          id: returnedContainer.id,
          skills: [{ type: 'anthropic', skill_id: format, version: 'latest' }]
        }
      }

      if (response['stop_reason'] === 'pause_turn') {
        continue
      }

      const ids = [
        ...new Set(
          records(response['content'])
            .filter((record) =>
              ['bash_code_execution_output', 'code_execution_output'].includes(
                String(record['type'])
              )
            )
            .map((record) => String(record['file_id'] || ''))
            .filter(Boolean)
        )
      ]

      return Promise.all(
        ids.map(async (id) => {
          const metadataResponse = await providerRequest(
            input.provider,
            `/files/${encodeURIComponent(id)}`,
            undefined,
            input.signal
          )
          const metadata = (await metadataResponse.json()) as {
            filename: string
            mime_type: string
          }

          return {
            filename: metadata.filename,
            mime_type: metadata.mime_type,
            data: await readMediaBytes(
              await providerRequest(
                input.provider,
                `/files/${encodeURIComponent(id)}/content`,
                undefined,
                input.signal
              )
            )
          }
        })
      )
    }

    throw new Error(
      'Hosted document execution exceeded its continuation limit.'
    )
  }

  const providerResponse = await providerRequest(
    input.provider,
    '/responses',
    {
      model: input.model,
      input: `Create a downloadable ${format} file. ${input.prompt}`,
      tools: [{ type: 'code_interpreter', container: { type: 'auto' } }]
    },
    input.signal
  )
  const response = (await providerResponse.json()) as Record<string, unknown>
  const citations = records(response['output']).filter(
    (record) => record['type'] === 'container_file_citation'
  )
  const files = new Map<string, Record<string, unknown>>()

  for (const citation of citations) {
    files.set(String(citation['file_id']), citation)
  }

  return Promise.all(
    [...files.values()].map(async (file) => ({
      filename: String(file['filename']),
      mime_type:
        DOCUMENT_MIME_TYPES[
          path.extname(String(file['filename'])).toLowerCase()
        ] || 'application/octet-stream',
      data: await readMediaBytes(
        await providerRequest(
          input.provider,
          `/containers/${encodeURIComponent(String(file['container_id']))}/files/${encodeURIComponent(String(file['file_id']))}/content`,
          undefined,
          input.signal
        )
      )
    }))
  )
}

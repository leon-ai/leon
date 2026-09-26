import { MAX_GENERATED_ARTIFACT_BYTES, API_VERSION } from '@/constants'
import fs from 'node:fs'
import path from 'node:path'

import type { Artifact, ArtifactFile } from '@/core/artifacts/artifact-types'
import type { ToolExecutionResult } from '@/core/tool-executor'

/**
 * Streams explicit deliverables over authenticated HTTP; screenshots retain the
 * bounded evidence channel, and large videos never become Socket.IO JSON blobs.
 */
export async function uploadSatelliteDeliverables(input: {
  result: ToolExecutionResult
  root: string
  sessionId: string
  remoteURL: string
  token: string
  signal?: AbortSignal
}): Promise<ToolExecutionResult> {
  const result = input.result.data.output['result'] as
    | { artifacts?: Array<ArtifactFile | Artifact> }
    | undefined

  if (input.result.status !== 'success' || !Array.isArray(result?.artifacts)) {
    return input.result
  }

  const artifacts: Array<ArtifactFile | Artifact> = []

  for (const file of result.artifacts) {
    if (!('presentation' in file) || file.presentation !== 'attachment') {
      artifacts.push(file)
      continue
    }

    const root = await fs.promises.realpath(input.root)
    const source = await fs.promises.realpath(file.path)
    const relative = path.relative(root, source)

    if (
      !relative ||
      relative.startsWith(`..${path.sep}`) ||
      relative === '..' ||
      path.isAbsolute(relative)
    ) {
      throw new Error('Satellite deliverable escapes its session.')
    }

    const stat = await fs.promises.stat(source)

    if (!stat.isFile() || stat.size > MAX_GENERATED_ARTIFACT_BYTES) {
      throw new Error('Invalid or oversized Satellite deliverable.')
    }

    const query = new URLSearchParams({
      filename: file.filename,
      mime_type: file.mime_type
    })
    const stream = fs.createReadStream(source)

    try {
      const response = await fetch(
        `${input.remoteURL.replace(/\/$/, '')}/api/${API_VERSION}/artifacts/${encodeURIComponent(input.sessionId)}?${query}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(stat.size),
            'x-leon-profile-token': input.token
          },
          body: stream as unknown as NonNullable<RequestInit['body']>,
          duplex: 'half',
          redirect: 'error',
          ...(input.signal ? { signal: input.signal } : {})
        } as RequestInit & { duplex: string }
      )

      if (!response.ok) {
        throw new Error(
          `Satellite deliverable upload failed (${response.status}); do not regenerate the original file.`
        )
      }

      artifacts.push((await response.json()) as Artifact)
    } finally {
      stream.destroy()
    }
  }

  return {
    ...input.result,
    data: {
      ...input.result.data,
      output: { ...input.result.data.output, result: { ...result, artifacts } }
    }
  }
}

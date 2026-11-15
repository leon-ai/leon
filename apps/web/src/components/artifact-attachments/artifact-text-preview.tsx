import { useEffect, useState } from 'react'
import { getFiletypeFromFileName } from '@pierre/diffs'
import type { ArtifactItem } from '../../../../../aurora/src/v2/widgets/artifacts'
import { CodeView } from '@/components/code-view'
import { Loader } from '@/components/loader'
import { ARTIFACT_PREVIEW_BYTES, readArtifactResource } from './artifact-resource'

/**
 * Shows a bounded first-page text excerpt with the existing syntax worker.
 * Text is never interpreted as HTML or executed as a document.
 */
export default function ArtifactTextPreview({ item }: { item: ArtifactItem }) {
  const [result, setResult] = useState<{ url: string, text: string, truncated: boolean }>()
  const [failed, setFailed] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    void readArtifactResource(item, ARTIFACT_PREVIEW_BYTES, controller.signal, true)
      .then(async ({ blob, truncated }) => {
        // Streaming decoding omits an incomplete final UTF-8 character rather
        // than displaying a replacement glyph at the byte boundary.
        const text = new TextDecoder().decode(await blob.arrayBuffer(), { stream: truncated })
        if (!controller.signal.aborted) {
          setResult({ url: item.url, text, truncated })
        }
      }).catch(() => {
        if (!controller.signal.aborted) {
          setFailed(item.url)
        }
      })

    return () => controller.abort()
  }, [item.url, item.mimeType])

  if (failed === item.url) {
    return <p className="artifact-preview-notice">Preview unavailable. You can still open or download this file.</p>
  }
  if (result?.url !== item.url) {
    return <div className="artifact-preview-notice"><Loader size="sm" /></div>
  }

  return <CodeView text={result.text} truncated={result.truncated} label={`Preview of ${item.filename}`}
    language={getFiletypeFromFileName(item.filename)} preview />
}

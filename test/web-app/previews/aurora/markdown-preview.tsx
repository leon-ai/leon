import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { Button } from '../../../../aurora/src/v2/components/button/button'
import { MarkdownContent } from '@/components/markdown-content'
import { FeedAnimationProvider } from '@/components/streaming-text'
import { useToast } from '@/components/toast'
import { createMarkdownPreviewExamples, type MarkdownPreviewExample } from '../../../fixtures/markdown-preview'
import imageURL from '../../../../aurora/preview/public/pancakes.jpeg?url&no-inline'

import './markdown-preview.sass'

const EXAMPLES = createMarkdownPreviewExamples(imageURL)
const STREAM_CHUNK_CHARACTERS = 64
const STREAM_INTERVAL_MS = 90

function MarkdownExample({ example }: { example: MarkdownPreviewExample }) {
  const [visibleCharacters, setVisibleCharacters] = useState(example.source.length)
  const [streaming, setStreaming] = useState(false)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!streaming) {
      return undefined
    }

    let characters = 0
    // Only an explicitly started, finite replay emits chunks. Leaving the
    // example stops its timer; the renderer itself owns character motion.
    const timer = window.setInterval(() => {
      characters = Math.min(characters + STREAM_CHUNK_CHARACTERS, example.source.length)
      setVisibleCharacters(characters)
      if (characters === example.source.length) {
        window.clearInterval(timer)
        setStreaming(false)
      }
    }, STREAM_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [streaming, example.source])

  return <>
    <div className="demo-controls">
      <Button disabled={streaming} onClick={() => {
        setRevision((value) => value + 1)
        setVisibleCharacters(0)
        setStreaming(true)
      }}>Replay streaming</Button>
      {streaming && <Button onClick={() => {
        setStreaming(false)
        setVisibleCharacters(example.source.length)
      }}>Show complete</Button>}
    </div>
    <FeedAnimationProvider key={revision} live
      historicalIds={revision === 0 ? [`markdown-preview-${example.id}-0`] : []}>
      <div className="markdown-preview-content" role="region" aria-label="Rendered Markdown">
        <MarkdownContent animationId={`markdown-preview-${example.id}-${revision}`}
          text={example.source.slice(0, visibleCharacters)} active={streaming} imagePrefix={imageURL} />
      </div>
    </FeedAnimationProvider>
  </>
}

/**
 * Renders the app's supported Markdown with local assets and bounded replay.
 * File references remain copyable, but this gallery never opens host files.
 */
export default function MarkdownPreview() {
  const [queryClient] = useState(() => new QueryClient())
  const { showToast } = useToast()

  useEffect(() => () => queryClient.clear(), [queryClient])

  return <section className="markdown-preview" aria-label="Markdown preview" onClickCapture={(event) => {
    if (event.target instanceof Element && event.target.closest('.file-path-open')) {
      event.preventDefault()
      event.stopPropagation()
      showToast({ type: 'info', title: 'Local preview', description: 'Host files cannot be opened here. You can still copy the path.' })
    }
  }}>
    <QueryClientProvider client={queryClient}>
      {EXAMPLES.map((example) => <section className="markdown-preview-example" key={example.id} aria-label={example.title}>
        <header className="markdown-preview-description"><h2>{example.title}</h2><p>{example.description}</p></header>
        <MarkdownExample example={example} />
      </section>)}
    </QueryClientProvider>
  </section>
}

import { Component, lazy, Suspense, useId, type CSSProperties, type ReactNode } from 'react'

import { Loader } from '@/components/loader'
import { MarkdownContent } from '@/components/markdown-content'
import { ScrollContainer } from '@/components/scroll-container'
import { CodeView } from '@/components/code-view'
import { CODE_PREVIEW_LINES } from '@/components/code-view/code-highlight-types'
import { prefetchModule } from '@/utils/prefetch'
import type { ToolChange } from '@/utils/tool-changes'
import type { ToolContentPart } from '../../../../../server/src/core/session-manager/tool-content-contract'

const ToolDiff = lazy(async () => {
  const module = await import('./tool-diff')

  return { default: module.ToolDiff }
})
const MAXIMUM_RENDERED_MARKDOWN_CHARACTERS = 65_536

/**
 * Starts an optional diff download while a real change disclosure opens.
 */
export function prefetchToolDiff(): void {
  prefetchModule(() => import('./tool-diff'))
}

class ToolContentBoundary extends Component<{ children: ReactNode, fallback: ReactNode }, { failed: boolean }> {
  public override state = { failed: false }

  public static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  public override render(): ReactNode {
    return this.state.failed ? (
      <>
        <p className="tool-diff-notice">I couldn’t load the change view. Check your connection; the raw output is available below.</p>
        {this.props.fallback}
      </>
    ) : this.props.children
  }
}

/**
 * Defers the diff engine without making raw output depend on a chunk download,
 * supported browser features, or successful syntax initialization.
 */
export function ToolChanges({ changes, truncated = false, fallback, preview = false }: {
  changes: ToolChange[]
  truncated?: boolean
  fallback: ReactNode
  preview?: boolean
}) {
  return (
    <div className={`tool-changes${preview ? ' tool-changes-preview' : ''}`}
      style={preview ? { '--code-preview-lines': CODE_PREVIEW_LINES } as CSSProperties : undefined}>
      <ToolContentBoundary fallback={fallback}>
        <Suspense fallback={fallback}><ToolDiff changes={changes} truncated={truncated} preview={preview} /></Suspense>
      </ToolContentBoundary>
    </div>
  )
}

interface ToolOutputProps {
  content: ToolContentPart | undefined
  label: string
  active?: boolean
  loading?: boolean
  preview?: boolean
  previewTail?: boolean
  animationId?: string
}

/**
 * Keeps prose readable and bounded while terminal/code results remain literal.
 */
export function ToolOutput({ content, label, active = false, loading = false, preview = false, previewTail = false, animationId }: ToolOutputProps) {
  const localId = useId()
  const markdown = content?.language === 'markdown'
  const rich = markdown && content.text.length <= MAXIMUM_RENDERED_MARKDOWN_CHARACTERS

  return (
    <div className={`tool-output${markdown && !rich ? ' tool-output-document-source' : ''}`}>
      {rich ? (
        <ScrollContainer
          className={`tool-output-markdown${preview ? ' tool-output-markdown-preview' : ''}`}
          viewportClassName="tool-output-markdown-viewport"
          role="region" aria-label={label} tabIndex={0}
          style={{ '--code-preview-lines': CODE_PREVIEW_LINES } as CSSProperties}>
          <MarkdownContent animationId={animationId ?? localId} text={content.text} active={active} />
          {content.truncated && <p className="tool-output-ellipsis" aria-label="More content omitted">…</p>}
        </ScrollContainer>
      ) : (
        <>
          {markdown && <p className="tool-diff-notice">Large output is shown as text to keep scrolling smooth.</p>}
          <CodeView
            text={content?.text ?? ''}
            label={label}
            language={content?.language ?? 'text'}
            active={active}
            preview={preview}
            previewTail={previewTail}
            truncated={content?.truncated ?? false}
          />
        </>
      )}
      {loading && !content && <span className="tool-output-loading"><Loader size="sm" label="Loading output…" /></span>}
    </div>
  )
}

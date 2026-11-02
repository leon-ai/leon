import { Component, lazy, Suspense, type CSSProperties, type ReactNode } from 'react'

import { Loader } from '@/components/loader'
import { CodeView } from '@/components/code-view'
import { CODE_PREVIEW_LINES } from '@/components/code-view/code-highlight-types'
import type { ToolChange } from '@/utils/tool-changes'
import type { ToolContentPart } from '../../../../../server/src/core/session-manager/tool-content-contract'

const ToolDiff = lazy(async () => {
  const module = await import('./tool-diff')

  return { default: module.ToolDiff }
})

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
}

/**
 * Shares the bounded code viewer between inline previews and inspectors.
 */
export function ToolOutput({ content, label, active = false, loading = false, preview = false, previewTail = false }: ToolOutputProps) {
  return (
    <div className="tool-output">
      <CodeView
        text={content?.text ?? ''}
        label={label}
        language={content?.language ?? 'text'}
        active={active}
        preview={preview}
        previewTail={previewTail}
        truncated={content?.truncated ?? false}
      />
      {loading && !content && <span className="tool-output-loading"><Loader size="sm" label="Loading output…" /></span>}
    </div>
  )
}

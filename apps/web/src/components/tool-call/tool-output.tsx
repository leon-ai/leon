import { Loader } from '@/components/loader'
import { CodeView } from '@/components/code-view'
import type { ToolContentPart } from '../../../../../server/src/core/session-manager/tool-content-contract'

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
      />
      {loading && !content && <span className="tool-output-loading"><Loader size="sm" label="Loading output…" /></span>}
    </div>
  )
}

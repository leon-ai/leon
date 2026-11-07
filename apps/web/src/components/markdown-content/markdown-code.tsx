import { lazy, Suspense, useRef, useState } from 'react'
import { useIsCodeFenceIncomplete } from 'streamdown'
import { CodeView } from '@/components/code-view'
import { CopyButton } from '@/components/copy-button'
import { Loader } from '@/components/loader'
import { Button } from '@/components/button'
import { Icon } from '@/components/icon'
import { Tooltip } from '@/components/tooltip'
import { CODE_THEME_STYLE } from '@/components/code-view/code-theme'
import { LanguageIcon } from './language-icon'

const Mermaid = lazy(() => import('./markdown-mermaid').catch(() => ({
  // Optional visualization downloads must never replace the answer with an error page.
  default: function UnavailableDiagram() {
    return <p className="markdown-diagram-notice">I couldn’t load this diagram. Check your connection; its source is available to copy.</p>
  }
})))

interface MarkdownCodeProps {
  text: string
  language: string
}

enum DiagramView {
  Diagram = 'diagram',
  Source = 'source'
}

/**
 * Shares the lazy syntax worker and bounded code viewport with tool output.
 */
export default function MarkdownCode({ text, language }: MarkdownCodeProps) {
  const incomplete = useIsCodeFenceIncomplete()
  const [view, setView] = useState(DiagramView.Diagram)
  const diagramRequested = useRef(false)
  const diagram = language === 'mermaid'
  const source = !diagram || view === DiagramView.Source
  const toggleLabel = source ? 'View diagram' : 'View diagram code'

  // Source-only inspection does not load Mermaid; visited drawings stay mounted.
  if (diagram && !source && !incomplete) {
    diagramRequested.current = true
  }

  return (
    <div className="markdown-code" style={CODE_THEME_STYLE}>
      <div className="markdown-code-header">
        <LanguageIcon language={language} />
        <div className="markdown-code-actions">
          {diagram && <Tooltip message={toggleLabel} position="top" blurOnClick={false}>
            <Button size="sm" ariaLabel={toggleLabel}
              icon={<Icon name="code-s-slash" state={source ? 'diagram' : 'source'} />}
              onClick={() => setView(source ? DiagramView.Diagram : DiagramView.Source)} />
          </Tooltip>}
          <CopyButton text={text} label="Copy code" size="sm" />
        </div>
      </div>
      {source && <CodeView text={text} language={language} label="Code block" active={incomplete} fitContent />}
      {diagram && <div className="markdown-diagram-block" hidden={source || incomplete}>
        {diagramRequested.current && <Suspense fallback={<div className="markdown-diagram-loading"><Loader size="sm" label="Loading diagram…" /></div>}>
          <Mermaid text={text} incomplete={incomplete} active={!source && !incomplete} />
        </Suspense>}
      </div>}
      {diagram && !source && incomplete && <div className="markdown-diagram-loading"><Loader size="sm" label="Drawing diagram…" /></div>}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MultiFileDiff } from '@pierre/diffs/react'
import { canUseWASM, createCSSVariablesTheme, disposeHighlighter, getFiletypeFromFileName, registerCustomTheme } from '@pierre/diffs'

import { CODE_THEME } from '@/components/code-view/code-theme'
import { bundledLanguages } from '@/components/code-view/fallback-languages'
import { ScrollContainer } from '@/components/scroll-container'
import { Button } from '@/components/button'
import { Tooltip } from '@/components/tooltip'
import { useTheme } from '@/hooks/use-theme'
import type { ToolChange } from '@/utils/tool-changes'
import '@fontsource/jetbrains-mono/latin-400.css'

const MAXIMUM_DIFF_LINES = 64
const MAXIMUM_DIFF_CHARACTERS = 8_192
const MAXIMUM_DIFF_EXCERPTS = 4
const THEME_NAME = 'leon-code'

enum DiffView {
  Hunks = 'hunks',
  Inline = 'inline',
  Split = 'split'
}

const DIFF_VIEWS = [
  { value: DiffView.Inline, label: 'Inline view', iconName: 'list-check', iconType: null },
  { value: DiffView.Split, label: 'Split view', iconName: 'layout-column', iconType: 'line' }
] as const

let viewers = 0
registerCustomTheme(THEME_NAME, async () => CODE_THEME, 'zed')
registerCustomTheme(THEME_NAME, async () => createCSSVariablesTheme({
  name: THEME_NAME,
  variableDefaults: {
    foreground: 'var(--color-text-secondary)', background: 'var(--color-surface-elevated)',
    'token-comment': 'var(--color-text-tertiary)', 'token-keyword': 'var(--color-pink)',
    'token-string-expression': 'var(--color-yellow)', 'token-string': 'var(--color-yellow)',
    'token-constant': 'var(--color-purple)', 'token-function': 'var(--color-accent)',
    'token-parameter': 'var(--color-text-secondary)', 'token-punctuation': 'var(--color-text-tertiary)'
  }
}), 'diffs')

const DIFF_CSS = `:host {
  --diffs-font-family: var(--font-family-code);
  --diffs-header-font-family: var(--font-family);
  --diffs-font-size: var(--font-size-xs);
  --diffs-line-height: 22px;
  --diffs-deletion-color-override: var(--color-danger);
  --diffs-addition-color-override: var(--color-success);
  --diffs-modified-color-override: var(--color-accent);
  --diffs-bg-deletion-override: var(--color-danger-soft);
  --diffs-bg-deletion-number-override: var(--color-danger-soft);
  --diffs-bg-deletion-emphasis-override: var(--color-danger-active);
  --diffs-bg-addition-override: var(--color-success-soft);
  --diffs-bg-addition-number-override: var(--color-success-soft);
  --diffs-bg-addition-emphasis-override: var(--color-success-soft);
  --diffs-bg-context-override: var(--color-surface-elevated);
  --diffs-bg-context-gutter-override: var(--color-surface-elevated);
  --diffs-bg-separator-override: var(--color-surface);
  --diffs-bg-hover-override: var(--color-surface-hover);
  --diffs-fg-number-override: var(--color-text-tertiary);
}`

// Bound the native scrolling element itself so its horizontal scrollbar stays
// reachable even when the recorded excerpt exceeds the preview's height.
const DIFF_PREVIEW_CSS = `[data-code] {
  max-height: calc(var(--code-preview-lines) * var(--diffs-line-height));
  overflow-y: hidden;
}`

function excerpt(text: string): string {
  // Diff bounded context before clipping the viewport so change locations do
  // not depend on the preview's visible height.
  return text.slice(0, MAXIMUM_DIFF_CHARACTERS).split('\n')
    .slice(0, MAXIMUM_DIFF_LINES).join('\n')
}

/**
 * Shows bounded, read-only replacement excerpts with native split/unified diff
 * rendering. Complete invocation data remains available in the inspector.
 */
export function ToolDiff({ changes, truncated = false, preview = false }: {
  changes: ToolChange[]
  truncated?: boolean
  preview?: boolean
}) {
  const [selectedView, setView] = useState(DiffView.Inline)
  const [previewClipped, setPreviewClipped] = useState(false)
  const handlePostRender = useCallback((node: HTMLElement): void => {
    // The renderer owns the shadow viewport and signals when its layout is ready.
    const code = node.shadowRoot?.querySelector<HTMLElement>('[data-code]')
    setPreviewClipped(Boolean(code && code.scrollHeight > code.clientHeight))
  }, [])
  const view = preview ? DiffView.Inline : selectedView
  const split = view === DiffView.Split
  const theme = useTheme()
  const files = useMemo(() => changes.slice(0, preview ? 1 : MAXIMUM_DIFF_EXCERPTS).map((change) => {
    const language = getFiletypeFromFileName(change.path)
    const lang = canUseWASM() || Object.hasOwn(bundledLanguages, language) ? language : 'text'

    return {
      oldFile: { name: change.path, contents: excerpt(change.oldText), lang },
      newFile: { name: change.path, contents: excerpt(change.newText), lang }
    }
  }), [changes, preview])
  const isTruncated = truncated || changes.length > files.length || changes.some((change) =>
    excerpt(change.oldText) !== change.oldText || excerpt(change.newText) !== change.newText)
  const options = useMemo(() => ({
    diffStyle: split ? 'split' as const : 'unified' as const,
    diffIndicators: 'classic' as const,
    preferredHighlighter: canUseWASM() ? 'highlights' as const : 'shiki-js' as const,
    theme: THEME_NAME, themeType: theme, unsafeCSS: preview ? `${DIFF_CSS}\n${DIFF_PREVIEW_CSS}` : DIFF_CSS,
    disableFileHeader: true, tokenizeMaxLength: MAXIMUM_DIFF_CHARACTERS,
    // Hunk rendering remains available for version-backed comparisons; tool
    // invocations show their recorded replacement context instead.
    expandUnchanged: view !== DiffView.Hunks,
    hunkSeparators: view === DiffView.Hunks ? 'metadata' as const : 'simple' as const,
    ...(preview ? { onPostRender: handlePostRender } : {})
  }), [split, theme, view, preview, handlePostRender])

  useEffect(() => {
    viewers++

    return (): void => {
      viewers--
      // Let child diff instances dispose before releasing the shared lexer cache.
      queueMicrotask(() => {
        if (viewers === 0) {
          void disposeHighlighter().catch(() => undefined)
        }
      })
    }
  }, [])

  const diffContent = files.map((file, index) => <MultiFileDiff key={index} {...file} options={options} />)

  return (
    <div className="tool-diff" data-diff-style={split ? 'split' : 'unified'} data-diff-view={view}>
      <div className="tool-diff-header">
        <p className="tool-diff-filename">{changes[0]?.path}</p>
        {!preview && <div className="tool-diff-views" role="group" aria-label="Diff view">
          {DIFF_VIEWS.map((item) => (
            <Tooltip key={item.value} message={item.label} position="top" blurOnClick={false}>
              <Button iconName={item.iconName} iconType={item.iconType} tone="muted"
                ariaLabel={item.label} ariaPressed={view === item.value} onClick={() => setView(item.value)} />
            </Tooltip>
          ))}
        </div>}
      </div>
      <div className="tool-diff-labels"><span>{split ? 'Before −' : view === DiffView.Hunks ? 'Changed hunks' : 'Changed excerpts'}</span>{split && <span>After +</span>}</div>
      {preview ? (
        <>
          <div className="tool-diff-preview-body">{diffContent}</div>
          {(isTruncated || previewClipped) && (
            <p className="tool-diff-ellipsis" aria-label="More content omitted">…</p>
          )}
        </>
      ) : (
        <ScrollContainer className="tool-diff-scroll" aria-label="Code changes" tabIndex={0}>
          {diffContent}
          <p className="tool-diff-notice">{isTruncated ? 'Truncated change preview. ' : ''}Changed excerpts, not complete files. Full input and output are available in Input and Output.</p>
        </ScrollContainer>
      )}
    </div>
  )
}

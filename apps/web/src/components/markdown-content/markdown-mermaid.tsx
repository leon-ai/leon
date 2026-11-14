import { useEffect, useLayoutEffect, useId, useMemo, useState } from 'react'
import DOMPurify from 'dompurify'
import { detectType, load, render } from 'pele/lazy'

import { Loader } from '@/components/loader'
import { VisualPreview } from '@/components/visual-preview/visual-preview'
import { useTheme } from '@/hooks/use-theme'
import { ExportableVisual } from '@/components/visual-export/visual-export'

const MAXIMUM_DIAGRAM_CHARACTERS = 16_384
const MAXIMUM_CACHED_DIAGRAMS = 8
const MAXIMUM_CACHE_CHARACTERS = 1_048_576
const MAXIMUM_DIAGRAM_EDGES = 500
const DIAGRAM_COLORS = {
  '--pele-bg': '--color-background',
  '--pele-fg': '--color-text',
  '--pele-muted': '--color-text-secondary',
  '--pele-line': '--color-text-secondary',
  '--pele-surface': '--color-surface',
  '--pele-surface-alt': '--color-surface-elevated',
  '--pele-border': '--color-border-strong',
  '--pele-accent': '--color-accent',
  '--pele-critical': '--color-danger',
  '--pele-series-1': '--color-accent',
  '--pele-series-2': '--color-accent-pink',
  '--pele-series-3': '--color-success',
  '--pele-series-4': '--color-purple',
  '--pele-series-5': '--color-yellow',
  '--pele-series-6': '--color-pink',
  '--pele-series-7': '--color-text-secondary',
  '--pele-series-8': '--color-text'
}
const diagrams = new Map<string, string>()
let cacheCharacters = 0

/**
 * Loads only completed diagrams' parsers, retaining bounded, sanitized SVGs.
 */
export default function MarkdownMermaid({ text, incomplete, active, onReady, actionsContainer }: {
  text: string
  incomplete: boolean
  active: boolean
  onReady?: (ready: boolean) => void
  actionsContainer?: HTMLElement | null | undefined
}) {
  const theme = useTheme()
  const id = useId().replaceAll(':', '')
  const [result, setResult] = useState({ key: '', svg: '', failed: false })
  const key = `${id}:${theme}:${text}`
  const oversized = text.length > MAXIMUM_DIAGRAM_CHARACTERS
  useLayoutEffect(() => {
    onReady?.(oversized || !incomplete && result.key === key)
  }, [onReady, oversized, incomplete, result.key, key])
  useEffect(() => {
    if (!active || incomplete || oversized) {
      return
    }
    let cancelled = false
    void (async () => {
      let svg = diagrams.get(key)
      if (svg) {
        diagrams.delete(key)
        diagrams.set(key, svg)
      } else {
        // Pele coalesces each type's download. Discard obsolete work before
        // synchronous parsing/layout, not just before updating React state.
        const [, math] = await Promise.all([
          load(detectType(text)),
          text.includes('$$') ? import('./markdown-math') : undefined
        ])
        if (cancelled) {
          return
        }
        const style = getComputedStyle(document.documentElement)
        const fontFamily = style.getPropertyValue('--font-family').trim()
        const labels = math?.createDiagramMath()
        let rendered: string
        try {
          rendered = render(text, {
            fontFamily,
            fontFamilyMono: style.getPropertyValue('--font-family-code').trim(),
            idPrefix: `leon-diagram-${id}-`,
            autoDirection: false,
            links: false,
            images: false,
            ...(labels ? { math: labels.resolve } : {}),
            limit: MAXIMUM_DIAGRAM_CHARACTERS,
            outputLimit: MAXIMUM_CACHE_CHARACTERS,
            maxEdges: MAXIMUM_DIAGRAM_EDGES
          }).svg
        } finally {
          labels?.dispose()
        }
        const fragment = DOMPurify.sanitize(rendered, {
          USE_PROFILES: { svg: true, svgFilters: true, mathMl: Boolean(math) },
          // Only generated MathML labels need an HTML integration point.
          ADD_TAGS: math ? ['foreignObject', 'div'] : [],
          HTML_INTEGRATION_POINTS: { foreignobject: true },
          FORBID_TAGS: ['a', 'image', 'img', 'style', 'mglyph', 'annotation-xml', ...(math ? [] : ['foreignObject'])],
          FORBID_ATTR: ['href', 'xlink:href', 'src', 'srcset'],
          RETURN_DOM_FRAGMENT: true
        })
        const drawing = fragment.firstElementChild as SVGSVGElement | null
        if (!drawing || drawing.localName !== 'svg') {
          throw new Error('I could not draw this diagram.')
        }
        // Resolve semantic tokens on the SVG itself so enlarged blob images
        // retain the same palette without inheriting the surrounding document.
        for (const [name, token] of Object.entries(DIAGRAM_COLORS)) {
          drawing.style.setProperty(name, style.getPropertyValue(token).trim())
        }
        drawing.style.setProperty('--pele-font', fontFamily)
        drawing.style.setProperty('--pele-font-mono', style.getPropertyValue('--font-family-code').trim())
        drawing.style.setProperty('--pele-radius', style.getPropertyValue('--border-radius-sm').trim())
        svg = new XMLSerializer().serializeToString(drawing)
        if (svg.length <= MAXIMUM_CACHE_CHARACTERS) {
          while (diagrams.size >= MAXIMUM_CACHED_DIAGRAMS || cacheCharacters + svg.length > MAXIMUM_CACHE_CHARACTERS) {
            const oldest = diagrams.keys().next().value!
            cacheCharacters -= diagrams.get(oldest)!.length
            diagrams.delete(oldest)
          }
          diagrams.set(key, svg)
          cacheCharacters += svg.length
        }
      }
      if (!cancelled) {
        setResult({ key, svg, failed: false })
      }
    })().catch(() => {
      if (!cancelled) {
        setResult({ key, svg: '', failed: true })
      }
    })

    return () => {
      cancelled = true
    }
  }, [id, text, theme, key, incomplete, oversized, active])

  // Control changes must not replace an unchanged, already-painted SVG tree.
  const drawing = useMemo(() => <span className="markdown-diagram" role="img" aria-label="Mermaid diagram"
    dangerouslySetInnerHTML={{ __html: result.svg }} />, [result.svg])

  if (oversized || (result.key === key && result.failed)) {
    return <p className="markdown-diagram-notice">I couldn’t draw this diagram. Its source is available to copy.</p>
  }
  if (incomplete || result.key !== key) {
    return <div className="markdown-diagram-loading"><Loader size="sm" label="Drawing diagram…" /></div>
  }

  return <ExportableVisual actionsContainer={actionsContainer} disabled={!active}><VisualPreview title="Diagram" label="Enlarge diagram" svg={result.svg} fullWidth>
    {drawing}
  </VisualPreview></ExportableVisual>
}

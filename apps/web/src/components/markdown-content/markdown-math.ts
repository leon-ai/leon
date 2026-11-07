import { createMathPlugin } from '@streamdown/math'
import katex from 'katex'
import type { MathResolver } from 'pele/lazy'
import 'katex/dist/katex.min.css'

// Formula HTML is generated after sanitizing the source; KaTeX never trusts URLs
// or HTML commands, and macro expansion stays bounded by its built-in limit.
export const math = createMathPlugin({ singleDollarTextMath: true, errorColor: 'var(--color-text-secondary)' })

/**
 * Shares KaTeX with diagram labels, measuring only while a diagram is rendered.
 * Native MathML needs no stylesheet or external resources inside enlarged SVGs.
 */
export function createDiagramMath(): { resolve: MathResolver, dispose: () => void } {
  const labels = new Map<string, ReturnType<MathResolver>>()
  let probe: HTMLDivElement | undefined

  return {
    resolve(tex, size): ReturnType<MathResolver> {
      const key = `${size}:${tex}`
      if (labels.has(key)) {
        return labels.get(key)
      }
      let result: ReturnType<MathResolver> = null
      try {
        probe ??= document.createElement('div')
        probe.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;display:inline-block;white-space:nowrap'
        probe.style.fontSize = `${size}px`
        probe.innerHTML = katex.renderToString(tex, {
          output: 'mathml', displayMode: true, throwOnError: true,
          trust: false, maxSize: 20, maxExpand: 1_000
        })
        document.body.append(probe)
        const expression = probe.querySelector('math')
        expression?.querySelector('annotation')?.remove()
        if (expression) {
          const { width, height } = expression.getBoundingClientRect()
          result = { html: expression.outerHTML, width, height }
        }
      } catch {
        // Unsupported formulas remain readable as source text.
      }
      labels.set(key, result)

      return result
    },
    dispose(): void {
      probe?.remove()
      labels.clear()
    }
  }
}

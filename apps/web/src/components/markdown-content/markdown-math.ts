import { createMathPlugin, type MathPlugin } from '@streamdown/math'
import katex from 'katex'
import type { MathResolver } from 'pele/lazy'
import type { BlockProps } from 'streamdown'
import 'katex/dist/katex.min.css'

const DOLLAR = '$'.charCodeAt(0)
const DIGIT = /^\d/
const FORMULA_START = /^[\p{L}\\]/u
const CURRENCY_IN_PROSE = /^\d[\d,]*(?:\.\d+)?(?:[*_]{1,2}(?=\s)|[.!?;:,]?\s+(?=\p{L}))/u

type RemarkPlugin = Extract<NonNullable<BlockProps['remarkPlugins']>[number], (...args: never[]) => unknown>
interface MathToken { start: { offset: number }, end: { offset: number } }
type MathState = (code: number | null) => MathState | undefined
type MathTokenizer = (
  this: { events: [string, MathToken, unknown][], sliceSerialize: (token: MathToken) => string },
  effects: unknown, ok: MathState, nok: MathState
) => MathState

// Formula HTML is generated after sanitizing the source; KaTeX never trusts URLs
// or HTML commands, and macro expansion stays bounded by its built-in limit.
const katexPlugin = createMathPlugin({ singleDollarTextMath: true, errorColor: 'var(--color-text-secondary)' })
const [remarkMath, mathOptions] = katexPlugin.remarkPlugin as [
  (this: ThisParameterType<RemarkPlugin>, options: unknown) => void, unknown
]

/**
 * Keeps ambiguous currency delimiters in Markdown while retaining saved inline
 * formulas. Rejecting at tokenization lets emphasis and links parse normally.
 */
export const math: MathPlugin = {
  ...katexPlugin,
  remarkPlugin: function currencyAwareMath(this: ThisParameterType<RemarkPlugin>): void {
    remarkMath.call(this, mathOptions)
    const data = this.data() as Record<string, unknown>
    const extensions = data['micromarkExtensions'] as { text: Record<number, { tokenize: MathTokenizer }> }[]
    const inlineMath = extensions.at(-1)!.text[DOLLAR]!
    const tokenize = inlineMath.tokenize

    inlineMath.tokenize = function tokenizeInlineMath(effects, ok, nok): MathState {
      const start = this.events.length

      return tokenize.call(this, effects, (code) => {
        const opening = this.events[start + 1]![1]
        if (opening.end.offset - opening.start.offset !== 1 || code === null || code < 0) {
          return ok(code)
        }

        const next = String.fromCodePoint(code)
        if (!DIGIT.test(next) && !FORMULA_START.test(next)) {
          return ok(code)
        }

        const formula = this.sliceSerialize(this.events[start]![1]).slice(1, -1)
        if (DIGIT.test(next) ? DIGIT.test(formula) : CURRENCY_IN_PROSE.test(formula)) {
          return nok(code)
        }

        return ok(code)
      }, nok)
    }
  }
}

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

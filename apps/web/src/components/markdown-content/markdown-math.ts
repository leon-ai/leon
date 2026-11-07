import { createMathPlugin } from '@streamdown/math'
import 'katex/dist/katex.min.css'

// Formula HTML is generated after sanitizing the source; KaTeX never trusts URLs
// or HTML commands, and macro expansion stays bounded by its built-in limit.
export const math = createMathPlugin({ singleDollarTextMath: true, errorColor: 'var(--color-text-secondary)' })


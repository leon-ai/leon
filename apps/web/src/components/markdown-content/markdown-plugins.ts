import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkAlert from 'remark-github-blockquote-alert'
import { defaultRehypePlugins, defaultRemarkPlugins, type BlockProps } from 'streamdown'

interface MarkdownElement {
  type: string
  properties?: Record<string, unknown>
  children?: MarkdownElement[]
}

const ALERT_CLASSES = ['markdown-alert', 'markdown-alert-note', 'markdown-alert-tip', 'markdown-alert-important', 'markdown-alert-warning', 'markdown-alert-caution']
const SCHEMA = {
  ...defaultSchema,
  // IDs and their references are scoped together after sanitization.
  clobberPrefix: '',
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.['div'] ?? []), ['className', ...ALERT_CLASSES]],
    p: [['className', 'markdown-alert-title']],
    code: (defaultSchema.attributes?.['code'] ?? []).map((attribute) =>
      Array.isArray(attribute) && attribute[0] === 'className'
        ? [...attribute, 'math-inline', 'math-display'] : attribute)
  }
}

export const MARKDOWN_REMARK_PLUGINS: NonNullable<BlockProps['remarkPlugins']> = [
  ...Object.values(defaultRemarkPlugins), remarkAlert
]
export const MARKDOWN_REHYPE_PLUGINS: NonNullable<BlockProps['rehypePlugins']> = [
  defaultRehypePlugins['raw']!, [rehypeSanitize, SCHEMA]
]

/**
 * Prevents footnotes and safe HTML IDs in separate messages from colliding.
 */
export function scopeMarkdown({ prefix }: { prefix: string }) {
  return (tree: MarkdownElement): void => {
    function visit(node: MarkdownElement): void {
      const props = node.properties
      if (props) {
        if (Array.isArray(props['className'])) {
          // GFM's class must not inherit the agent plan-step component's layout.
          props['className'] = props['className'].map((name) => name === 'task-list-item' ? 'markdown-task-item' : name)
        }
        for (const attribute of ['id', 'name']) {
          if (typeof props[attribute] === 'string') {
            props[attribute] = prefix + props[attribute]
          }
        }
        if (typeof props['href'] === 'string' && props['href'].startsWith('#')) {
          props['href'] = `#${prefix}${props['href'].slice(1)}`
        }
        for (const attribute of ['ariaDescribedBy', 'ariaLabelledBy']) {
          if (typeof props[attribute] === 'string') {
            props[attribute] = props[attribute].split(' ').map((id) => prefix + id).join(' ')
          } else if (Array.isArray(props[attribute])) {
            props[attribute] = props[attribute].map((id) => prefix + id)
          }
        }
      }
      node.children?.forEach(visit)
    }

    visit(tree)
  }
}

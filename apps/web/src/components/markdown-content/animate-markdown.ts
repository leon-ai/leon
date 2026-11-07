// A small structural tree contract keeps this adapter independent of parser internals.
interface MarkdownNode {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: MarkdownNode[]
  position?: { start: { offset?: number }, end: { offset?: number } }
}

/**
 * Routes prose through Leon's character renderer without animating fenced code,
 * structural whitespace, or an unbounded initial text burst.
 */
export function animateMarkdown({ tailStart = 0 } = {}) {
  return (tree: MarkdownNode): void => {
    function visit(parent: MarkdownNode): void {
      if (!parent.children || ['pre', 'svg', 'math'].includes(parent.tagName ?? '') ||
        (Array.isArray(parent.properties?.['className']) && parent.properties['className'].includes('katex'))) {
        return
      }

      parent.children = parent.children.map((node) => {
        if (node.type !== 'text' || !node.value?.trim()) {
          visit(node)
          return node
        }

        const start = node.position?.start.offset
        if (start === undefined || (node.position?.end.offset ?? start) < tailStart) {
          return node
        }

        return {
          type: 'element',
          tagName: 'leon-text',
          properties: { offset: start },
          children: [node]
        }
      })
    }

    visit(tree)
  }
}

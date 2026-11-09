export const FILE_PATH_ELEMENT = 'leon-file-path'
const OPEN_MARKER = '[FILE_PATH]'
const CLOSE_MARKER = '[/FILE_PATH]'
const LITERAL_ELEMENTS = new Set(['pre', 'a', 'svg', 'math'])

interface PathNode {
  type: string
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
  children?: PathNode[]
  position?: { start: { offset?: number }, end: { offset?: number } }
}

function withoutPartialMarker(value: string, marker: string): string {
  for (let length = Math.min(value.length, marker.length - 1); length > 0; length--) {
    if (value.endsWith(marker.slice(0, length))) {
      return value.slice(0, -length)
    }
  }

  return value
}

/**
 * Converts legacy path markers after HTML sanitization. Only explicit references
 * become controls; fenced examples and links keep their literal meaning.
 * Partial streaming delimiters stay hidden and never become actionable paths.
 */
export function renderFilePaths({ active = false } = {}) {
  return (tree: PathNode, file: { value: unknown }): void => {
    const source = String(file.value)

    function joinPathFragments(children: PathNode[]): PathNode[] {
      const result: PathNode[] = []
      for (let index = 0; index < children.length; index++) {
        const child = children[index]!
        const open = child.value?.lastIndexOf(OPEN_MARKER) ?? -1
        if (child.type !== 'text' || open < 0 || child.value!.indexOf(CLOSE_MARKER, open) >= 0 ||
          child.position?.end.offset === undefined) {
          result.push(child)
          continue
        }

        // Markdown may split a literal path at underscores or bracket syntax.
        // Recover only the marked span from its source, preserving surrounding prose.
        const start = source.lastIndexOf(OPEN_MARKER, child.position.end.offset)
        const end = source.indexOf(CLOSE_MARKER, start + OPEN_MARKER.length)
        let last = index + 1
        while (last < children.length && (children[last]!.position?.end.offset ?? 0) < end + CLOSE_MARKER.length) {
          last++
        }
        const tail = children[last]
        const close = tail?.value?.indexOf(CLOSE_MARKER) ?? -1
        if (start < 0 || end < 0 || tail?.type !== 'text' || close < 0) {
          result.push(child)
          continue
        }

        const boundary = end + CLOSE_MARKER.length
        result.push({ ...child, value: child.value!.slice(0, open) + source.slice(start, boundary) })
        const remainder = tail.value!.slice(close + CLOSE_MARKER.length)
        if (remainder) {
          // Keep following references separate so each marked path is recovered once.
          children[last] = { ...tail, value: remainder, position: {
            start: { offset: boundary }, end: tail.position!.end
          } }
          index = last - 1
        } else {
          index = last
        }
      }

      return result
    }

    function split(node: PathNode): PathNode[] {
      const value = node.value ?? ''
      const parts: PathNode[] = []
      const base = node.position?.start.offset ?? 0
      let cursor = 0

      function text(content: string, offset: number): void {
        if (content) {
          parts.push({ ...node, value: content, position: {
            start: { offset: base + offset }, end: { offset: base + offset + content.length }
          } })
        }
      }

      while (cursor < value.length) {
        const start = value.indexOf(OPEN_MARKER, cursor)
        if (start < 0) {
          const remainder = value.slice(cursor)
          text(active ? withoutPartialMarker(remainder, OPEN_MARKER) : remainder, cursor)
          break
        }
        text(value.slice(cursor, start), cursor)
        const pathStart = start + OPEN_MARKER.length
        const end = value.indexOf(CLOSE_MARKER, pathStart)
        const path = end < 0 ? withoutPartialMarker(value.slice(pathStart), CLOSE_MARKER) : value.slice(pathStart, end)
        if (path) {
          parts.push({ type: 'element', tagName: FILE_PATH_ELEMENT,
            properties: { path, complete: end >= 0 }, children: [],
            position: { start: { offset: base + start }, end: { offset: base + (end < 0 ? value.length : end + CLOSE_MARKER.length) } } })
        }
        cursor = end < 0 ? value.length : end + CLOSE_MARKER.length
      }

      return parts
    }

    function visit(parent: PathNode): void {
      if (!parent.children || LITERAL_ELEMENTS.has(parent.tagName ?? '') ||
        Array.isArray(parent.properties?.['className']) && parent.properties['className'].includes('katex')) {
        return
      }
      parent.children = joinPathFragments(parent.children).flatMap((child) => {
        if (child.type === 'text' && child.value?.includes('[')) {
          return split(child)
        }
        visit(child)

        return [child]
      })
    }

    visit(tree)
  }
}

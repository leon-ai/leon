import type { LayoutBlock } from '@llamaindex/liteparse'

const MAX_LAYOUT_CHARS = 40_000

export interface DocumentLayout {
  width: number
  height: number
  units: 'points' | 'pixels'
  blocks: (LayoutBlock & { polygon?: number[][], confidence?: number })[]
}

export interface LayoutReadOptions {
  layout?: boolean
  layoutOffset?: number
}

/**
 * Keep geometry opt-in and bounded independently of paginated document text.
 * Coordinates retain the source's top-left origin and stated dimensions.
 */
export function sliceLayout(layout: DocumentLayout, offset = 0): Record<string, unknown> {
  if (!Number.isInteger(offset) || offset < 0 || offset > layout.blocks.length) {
    throw new Error('Use a valid layoutOffset from nextLayoutOffset.')
  }
  const blocks = []
  let size = 0
  let index = offset
  for (; index < layout.blocks.length; index += 1) {
    const block = layout.blocks[index]!
    const length = JSON.stringify(block).length
    if (size + length > MAX_LAYOUT_CHARS && blocks.length) break
    // A single huge table cannot strand pagination. Preserve its location and
    // explicitly omit its contents rather than returning a misleading fragment.
    const bounded = length > MAX_LAYOUT_CHARS
      ? { kind: block.kind, bbox: block.bbox, omitted: 'Block exceeds layout budget; use page text or rendered evidence.' }
      : block
    blocks.push(bounded)
    size += JSON.stringify(bounded).length
  }
  return { ...layout, blocks, layoutOffset: offset, totalBlocks: layout.blocks.length,
    nextLayoutOffset: index < layout.blocks.length ? index : null }
}

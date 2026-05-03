import type {
  BuiltInCommandRenderBlock,
  BuiltInCommandRenderListItem,
  BuiltInCommandResult,
  BuiltInCommandResultTone
} from '@/built-in-command/built-in-command'

export type BuiltInCommandRenderRuntime = 'ui' | 'terminal'

interface CreateListResultInput {
  title: string
  tone: BuiltInCommandResultTone
  header?: string
  items: BuiltInCommandRenderListItem[]
}

function renderListItemForTerminal(item: BuiltInCommandRenderListItem): string {
  const textParts = [`- ${item.label}`]
  const resolvedValue = item.value || item.href
  const hasInlineLink = !!item.inline_link_label && !!item.inline_link_href

  if (resolvedValue) {
    textParts.push(`: ${resolvedValue}`)
  }

  if (hasInlineLink) {
    textParts.push(` ${item.inline_link_label}: ${item.inline_link_href}`)
  }

  if (item.description) {
    textParts.push(resolvedValue ? ` (${item.description})` : ` - ${item.description}`)
  }

  return textParts.join('')
}

function renderBlockForTerminal(block: BuiltInCommandRenderBlock): string[] {
  if (block.type !== 'list') {
    return []
  }

  const lines = block.header ? [block.header] : []

  for (const item of block.items) {
    lines.push(renderListItemForTerminal(item))
  }

  return lines
}

export function renderBuiltInCommandResult(
  result: Omit<BuiltInCommandResult, 'plain_text'>,
  runtime: BuiltInCommandRenderRuntime
): string[] {
  if (runtime === 'ui') {
    return []
  }

  const lines = [result.title]

  for (const block of result.blocks) {
    const renderedBlock = renderBlockForTerminal(block)

    if (renderedBlock.length > 0) {
      lines.push(...renderedBlock)
    }
  }

  return lines
}

export function createListResult(
  input: CreateListResultInput
): BuiltInCommandResult {
  const result = {
    title: input.title,
    tone: input.tone,
    blocks: [
      {
        type: 'list' as const,
        ...(input.header ? { header: input.header } : {}),
        items: input.items
      }
    ]
  }

  return {
    ...result,
    plain_text: renderBuiltInCommandResult(result, 'terminal')
  }
}

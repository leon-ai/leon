import { createContext, memo, useCallback, useContext, useId, useMemo, useRef } from 'react'
import { clsx } from 'clsx'
import {
  Block,
  Streamdown,
  parseMarkdownIntoBlocks,
  type BlockProps,
  type Components
} from 'streamdown'

import { StreamingText } from '@/components/streaming-text'
import { useProfile } from '@/data/profile'
import { MarkdownLink } from './markdown-link'
import { animateMarkdown } from './animate-markdown'
import { MarkdownBlockContext } from './markdown-context'
import MarkdownCode from './markdown-code'
import { MARKDOWN_REHYPE_PLUGINS, MARKDOWN_REMARK_PLUGINS, scopeMarkdown } from './markdown-plugins'

import '@fontsource/jetbrains-mono/latin-400.css'
import './markdown-content.sass'

const MAXIMUM_ANIMATED_SOURCE_CHARACTERS = 1_024
const MarkdownAnimationContext = createContext({
  animationId: '',
  startDelay: 0,
  scopeId: '',
  profile: '',
  completed: false,
  math: false,
  revealWindow: { firstBlock: 0, offset: 0 }
})
const LINK_SAFETY = { enabled: false }

interface MarkdownContentProps {
  animationId: string
  text: string
  active?: boolean | undefined
  startDelay?: number
  className?: string
}

const MarkdownBlock = memo(function MarkdownBlock(props: BlockProps) {
  const block = useMemo(() => ({ index: props.index, content: props.content }), [props.index, props.content])
  const { animationId, revealWindow, scopeId } = useContext(MarkdownAnimationContext)
  // Large initial/final bursts reveal only their tail. Freeze this starting
  // boundary so a growing block cannot remove characters that are still fading.
  const initialTailStart = props.index < revealWindow.firstBlock
    ? Infinity
    : props.index === revealWindow.firstBlock ? revealWindow.offset : 0
  const tailStart = useRef({ animationId, offset: initialTailStart })
  if (tailStart.current.animationId !== animationId) {
    tailStart.current = { animationId, offset: initialTailStart }
  }

  const plugins = useMemo<NonNullable<BlockProps['rehypePlugins']>>(
    () => [...(props.rehypePlugins ?? MARKDOWN_REHYPE_PLUGINS), [scopeMarkdown, { prefix: scopeId }],
      [animateMarkdown, { tailStart: tailStart.current.offset }]],
    [animationId, props.rehypePlugins, scopeId]
  )

  return (
    <MarkdownBlockContext.Provider value={block}>
      <Block {...props} rehypePlugins={plugins} />
    </MarkdownBlockContext.Provider>
  )
})

const COMPONENTS: Components = {
  a: MarkdownLink,
  h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6',
  p: 'p', ul: 'ul', ol: 'ol', li: 'li', blockquote: 'blockquote', hr: 'hr',
  div: 'div', span: 'span', section: 'section', sup: 'sup', sub: 'sub',
  details: 'details', summary: 'summary',
  strong: 'strong', em: 'em', del: 'del',
  table: 'table',
  thead: 'thead', tbody: 'tbody', tr: 'tr', th: 'th', td: 'td',
  // External images can leak conversation data through model-authored URLs.
  img: ({ alt }) => alt ? <span className="markdown-image-alt">{alt}</span> : null,
  pre: ({ node, children }) => {
    const code = node?.children.find((child) => child.type === 'element' && child.tagName === 'code')
    if (code?.type !== 'element') {
      return <pre>{children}</pre>
    }

    const text = code.children.map((child) => child.type === 'text' ? child.value : '').join('')
    const classes = Array.isArray(code.properties['className']) ? code.properties['className'] : []
    const language = String(classes.find((name) => String(name).startsWith('language-')) ?? '').slice('language-'.length) || 'text'

    return <MarkdownCode text={text} language={language} />
  },
  code: 'code', inlineCode: ({ children }) => <code>{children}</code>,
  'leon-text': function MarkdownText({ node, children }) {
    const { animationId, startDelay } = useContext(MarkdownAnimationContext)
    const { index } = useContext(MarkdownBlockContext)
    const text = typeof children === 'string' ? children : ''

    return <StreamingText animationId={`${animationId}:block:${index}:${node?.properties['offset']}`}
      text={text} startDelay={startDelay} />
  }
}

/**
 * Uses the same safe Markdown pipeline for live and saved prose. Streamdown owns
 * parsing and block memoization; Leon's renderer alone owns character motion.
 */
export function MarkdownContent({ animationId, text, active = false, startDelay = 0, className }: MarkdownContentProps) {
  const scopeId = useId()
  const profile = useProfile()
  const animation = useMemo(() => ({
    animationId,
    startDelay,
    scopeId: `leon-${scopeId}-`,
    profile,
    completed: !active,
    math: false,
    revealWindow: { firstBlock: 0, offset: 0 }
  }), [animationId, startDelay, scopeId, profile, active])
  const parseBlocks = useCallback((markdown: string): string[] => {
    const blocks = parseMarkdownIntoBlocks(markdown)
    let remaining = MAXIMUM_ANIMATED_SOURCE_CHARACTERS
    let firstBlock = blocks.length
    while (firstBlock > 0 && remaining > 0) {
      firstBlock--
      remaining -= blocks[firstBlock]!.length
    }
    animation.revealWindow.firstBlock = firstBlock
    animation.revealWindow.offset = Math.max(0, -remaining)

    return blocks
  }, [animation, profile, active])

  return (
    <MarkdownAnimationContext.Provider value={animation}>
      <Streamdown className={clsx('markdown-content', className)}
        components={COMPONENTS} BlockComponent={MarkdownBlock}
        rehypePlugins={MARKDOWN_REHYPE_PLUGINS} remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        parseMarkdownIntoBlocksFn={parseBlocks}
        animated={false} isAnimating={active} controls={false}
        linkSafety={LINK_SAFETY}>
        {text}
      </Streamdown>
    </MarkdownAnimationContext.Provider>
  )
}

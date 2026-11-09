import { createContext, memo, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import {
  Block,
  Streamdown,
  parseMarkdownIntoBlocks,
  type BlockProps,
  type Components,
  type PluginConfig
} from 'streamdown'

import { StreamingText } from '@/components/streaming-text'
import { ExportableVisual } from '@/components/visual-export/visual-export'
import { VisualLayout } from '@/components/visual-layout/visual-layout'
import { Icon } from '@/components/icon'
import { useProfile } from '@/data/profile'
import { MarkdownLink } from './markdown-link'
import { FilePath } from '@/components/file-path/file-path'
import { FILE_PATH_ELEMENT, renderFilePaths } from './file-paths'
import { animateMarkdown } from './animate-markdown'
import { MarkdownBlockContext } from './markdown-context'
import MarkdownCode from './markdown-code'
import { MARKDOWN_REHYPE_PLUGINS, MARKDOWN_REMARK_PLUGINS, scopeMarkdown } from './markdown-plugins'
import { cacheMarkdownParse, MarkdownCacheKind, readCompletedMarkdown } from './markdown-cache'

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
const ALERT_ICONS: Record<string, string> = {
  NOTE: 'github-note', TIP: 'github-tip', IMPORTANT: 'github-important', WARNING: 'github-warning', CAUTION: 'github-caution'
}
let mathRequest: Promise<typeof import('./markdown-math')> | undefined
let cachedMath: PluginConfig['math']

interface MarkdownContentProps {
  animationId: string
  text: string
  active?: boolean | undefined
  startDelay?: number
  className?: string
}

const MarkdownBlock = memo(function MarkdownBlock(props: BlockProps) {
  const { animationId, revealWindow, scopeId, profile, completed, math } = useContext(MarkdownAnimationContext)
  const block = useMemo(() => ({ index: props.index, content: props.content, identity: `${animationId}:${props.index}` }),
    [animationId, props.index, props.content])
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
      [renderFilePaths, { active: !completed }],
      [animateMarkdown, { tailStart: tailStart.current.offset }]],
    [animationId, props.rehypePlugins, scopeId, completed]
  )
  const remarkPlugins = useMemo<NonNullable<BlockProps['remarkPlugins']>>(
    () => [...(props.remarkPlugins ?? MARKDOWN_REMARK_PLUGINS), [cacheMarkdownParse, { profile, completed, math }]],
    [props.remarkPlugins, profile, completed, math]
  )

  return (
    <MarkdownBlockContext.Provider value={block}>
      <Block {...props} rehypePlugins={plugins} remarkPlugins={remarkPlugins} />
    </MarkdownBlockContext.Provider>
  )
})

const COMPONENTS: Components = {
  [FILE_PATH_ELEMENT]: function MarkdownFilePath({ node }) {
    const { animationId } = useContext(MarkdownAnimationContext)
    const { index } = useContext(MarkdownBlockContext)
    const path = node?.properties['path']

    return typeof path === 'string' ? <FilePath path={path} complete={node?.properties['complete'] === true}
      animationId={`${animationId}:block:${index}:path:${node?.position?.start.offset}`} /> : null
  },
  a: MarkdownLink,
  h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6',
  p: ({ node, children, className }) => {
    if (className === 'markdown-alert-title') {
      const title = node?.children.find((child) => child.type === 'text')?.value.trim() ?? 'NOTE'
      return <p className={className}><Icon name={ALERT_ICONS[title] ?? 'github-note'} />{title[0]}{title.slice(1).toLowerCase()}</p>
    }

    return <p>{children}</p>
  },
  ul: 'ul', ol: 'ol', li: 'li', blockquote: 'blockquote', hr: 'hr',
  div: 'div', span: 'span', section: 'section', sup: 'sup', sub: 'sub',
  details: 'details', summary: 'summary',
  input: ({ checked }) => <span className="markdown-task-checkbox">
    <input type="checkbox" checked={Boolean(checked)} disabled readOnly
      aria-label={checked ? 'Completed task' : 'Pending task'} />
    {checked && <Icon name="check-fill" />}
  </span>,
  strong: 'strong', em: 'em', del: 'del',
  table: function MarkdownTable({ children }) {
    const { completed } = useContext(MarkdownAnimationContext)

    return <ExportableVisual disabled={!completed} contentSelector="table"><div className="markdown-table"><table>{children}</table></div></ExportableVisual>
  },
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
      text={text} startDelay={startDelay} compact />
  }
}

/**
 * Uses the same safe Markdown pipeline for live and saved prose. Streamdown owns
 * parsing and block memoization; Leon's renderer alone owns character motion.
 */
export function MarkdownContent({ animationId, text, active = false, startDelay = 0, className }: MarkdownContentProps) {
  const scopeId = useId()
  const profile = useProfile()
  const [math, setMath] = useState<PluginConfig['math']>(cachedMath)
  const [mathFailed, setMathFailed] = useState(false)
  const hasMath = text.includes('$')
  useEffect(() => {
    if (!hasMath || math) {
      return
    }
    let cancelled = false
    mathRequest ??= import('./markdown-math').then((module) => {
      cachedMath = module.math

      return module
    }).catch((error: unknown) => {
      mathRequest = undefined
      throw error
    })
    void mathRequest.then((module) => {
      if (!cancelled) {
        setMath(module.math)
      }
    }).catch(() => {
      if (!cancelled) {
        setMathFailed(true)
      }
    })

    return () => {
      cancelled = true
    }
  }, [hasMath, math])
  const plugins = useMemo(() => math ? { math } : {}, [math])
  const animation = useMemo(() => ({
    animationId,
    startDelay,
    scopeId: `leon-${scopeId}-`,
    profile,
    completed: !active,
    math: Boolean(math),
    revealWindow: { firstBlock: 0, offset: 0 }
  }), [animationId, startDelay, scopeId, profile, active, math])
  const parseBlocks = useCallback((markdown: string): string[] => {
    const blocks = readCompletedMarkdown(profile, MarkdownCacheKind.Blocks, markdown, !active, () => parseMarkdownIntoBlocks(markdown))
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

  const content = (
    <MarkdownAnimationContext.Provider value={animation}>
      <Streamdown className={clsx('markdown-content', className)}
        components={COMPONENTS} BlockComponent={MarkdownBlock}
        rehypePlugins={MARKDOWN_REHYPE_PLUGINS} remarkPlugins={MARKDOWN_REMARK_PLUGINS} plugins={plugins}
        parseMarkdownIntoBlocksFn={parseBlocks}
        animated={false} isAnimating={active} controls={false}
        linkSafety={LINK_SAFETY}>
        {text}
      </Streamdown>
    </MarkdownAnimationContext.Provider>
  )

  return hasMath ? <VisualLayout identity={`${animationId}:math`} ready={Boolean(active || math || mathFailed)}
    estimatedHeight="160px" label="Preparing formulas…">{content}</VisualLayout> : content
}

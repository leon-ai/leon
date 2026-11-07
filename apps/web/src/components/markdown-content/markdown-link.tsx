import { useContext } from 'react'
import { StreamdownContext, type Components } from 'streamdown'
import { MarkdownBlockContext } from './markdown-context'

/**
 * Keeps unsafe or incomplete destinations out of streamed navigation.
 */
export const MarkdownLink: NonNullable<Components['a']> = function MarkdownLink({ href, children, title, node }) {
  const { isAnimating } = useContext(StreamdownContext)
  const { content } = useContext(MarkdownBlockContext)
  if (href?.startsWith('#')) {
    return <a className="markdown-link" href={href} aria-label={node?.properties['ariaLabel'] as string | undefined}>{children}</a>
  }
  let url: URL
  try {
    url = new URL(href ?? '')
  } catch {
    return <>{children}</>
  }
  if (!['http:', 'https:', 'mailto:'].includes(url.protocol) || url.username || url.password) {
    return <>{children}</>
  }
  const end = node?.position?.end.offset ?? 0
  const lastCharacter = content[end - 1]
  const unfinished = isAnimating && end >= content.length && lastCharacter !== ')' && lastCharacter !== '>'
  return <a className="markdown-link" href={unfinished ? undefined : url.href} aria-description={title}
    aria-disabled={unfinished || undefined} target={url.protocol === 'mailto:' ? undefined : '_blank'}
    rel="noopener noreferrer" referrerPolicy="no-referrer">{children}</a>
}

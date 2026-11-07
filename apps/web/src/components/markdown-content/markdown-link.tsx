import { useContext, useState } from 'react'
import { StreamdownContext, type Components } from 'streamdown'

import { Icon } from '@/components/icon'
import { Tooltip } from '@/components/tooltip'
import { MarkdownBlockContext } from './markdown-context'

const FAVICON_RETRY_DELAY_MS = 30_000

/**
 * Shows cached, same-origin favicons without sending chat text to a third party.
 */
export const MarkdownLink: NonNullable<Components['a']> = function MarkdownLink({ href, children, title, node }) {
  const [failure, setFailure] = useState<{ origin: string, at: number }>()
  const [loadedOrigin, setLoadedOrigin] = useState<string>()
  const { isAnimating } = useContext(StreamdownContext)
  const { content } = useContext(MarkdownBlockContext)
  if (href?.startsWith('#')) {
    return <a className="markdown-link" href={href} aria-label={node?.properties['ariaLabel'] as string | undefined}>{children}</a>
  }

  let url: URL | undefined
  try {
    url = new URL(href ?? '')
  } catch {
    // Incomplete streaming destinations remain readable, non-interactive text.
  }

  if (!url || !['http:', 'https:', 'mailto:'].includes(url.protocol) || url.username || url.password) {
    return <>{children}</>
  }

  const web = url.protocol !== 'mailto:'
  const end = node?.position?.end.offset ?? 0
  const lastCharacter = content[end - 1]
  // Bare URLs can grow one hostname character at a time. Do not fetch their
  // icon until the destination has a closing delimiter or trailing whitespace.
  const unfinished = isAnimating && end >= content.length && lastCharacter !== ')' && lastCharacter !== '>'
  const favicon = web && !unfinished && failure?.origin !== url.origin
  const loaded = favicon && loadedOrigin === url.origin

  function retryFavicon(): void {
    if (failure && Date.now() - failure.at >= FAVICON_RETRY_DELAY_MS) {
      setFailure(undefined)
    }
  }

  return (
    <Tooltip message={url.href}
      position="top" multiline blurOnClick={false}
      disabled={unfinished} className="markdown-link-tooltip">
      <a className="markdown-link" href={unfinished ? undefined : url.href} aria-description={title}
        aria-disabled={unfinished || undefined}
        onMouseEnter={retryFavicon}
        onFocus={retryFavicon}
        target={web ? '_blank' : undefined} rel="noopener noreferrer" referrerPolicy="no-referrer">
        {web && <span className="markdown-link-icon" aria-hidden="true">
          {!loaded && <Icon name="global-line" />}
          {favicon && <img src={`/api/v1/favicons?origin=${encodeURIComponent(url.origin)}`}
            width={14} height={14} alt="" loading="lazy" decoding="async"
            data-loaded={loaded}
            onLoad={() => setLoadedOrigin(url.origin)}
            onError={() => setFailure({ origin: url.origin, at: Date.now() })} />}
        </span>}
        {children}
      </a>
    </Tooltip>
  )
}

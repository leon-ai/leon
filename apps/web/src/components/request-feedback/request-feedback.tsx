import { useLayoutEffect, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'

import { Button } from '@/components/button'
import { ConnectionError } from '@/data/request-errors'

import './request-feedback.sass'

/**
 * Centers request progress and page-level failures above the composer. Only
 * failures offer retry actions; transport policy and toast reporting stay in Query.
 */
export function RequestFeedback({ error = null, message, role = 'alert', paused = false, retrying = false, retryLabel = 'Retry', onRetry }: {
  error?: Error | null
  message?: string
  role?: 'alert' | 'status'
  paused?: boolean
  retrying?: boolean
  retryLabel?: string
  onRetry?: () => void
}) {
  const feedbackRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useLayoutEffect(() => {
    const feedback = feedbackRef.current
    const main = feedback?.closest<HTMLElement>('.app-main')
    if (!feedback || !main) {
      return undefined
    }
    let composer: HTMLElement | null = null
    let feed: HTMLElement | null = null
    const updateBounds = (): void => {
      if (!composer?.isConnected) {
        return
      }
      const bounds = composer.getBoundingClientRect()
      const top = main.getBoundingClientRect().top + (feed ? Number.parseFloat(getComputedStyle(feed).paddingTop) : 0)
      Object.assign(feedback.style, {
        top: `${top}px`, left: `${bounds.left}px`, width: `${bounds.width}px`,
        height: `${Math.max(0, bounds.top - top)}px`
      })
    }

    // Error placement follows the same real composer geometry as the feed,
    // including restored drafts, viewport changes and sidebar transitions.
    const observer = new ResizeObserver(updateBounds)
    observer.observe(main)
    const bindComposer = (): void => {
      if (composer) {
        observer.unobserve(composer)
      }
      composer = main.querySelector<HTMLElement>('.query-input')
      feed = main.querySelector<HTMLElement>('.feed')
      if (composer) {
        observer.observe(composer)
        updateBounds()
      }
    }
    // Lazy routes can finish rendering after the location changes. Bind to
    // committed content rather than retaining the previous page's composer.
    const unsubscribe = router.subscribe('onRendered', bindComposer)
    bindComposer()

    return () => {
      unsubscribe()
      observer.disconnect()
    }
  }, [router])

  return (
    <div ref={feedbackRef} role={role} className="request-feedback">
      <p>{message ?? (paused ? new ConnectionError().message : error?.message)}</p>
      {onRetry && (
        <Button variant="secondary" disabled={paused || retrying} onClick={onRetry}>
          {retrying ? 'Retrying…' : retryLabel}
        </Button>
      )}
    </div>
  )
}

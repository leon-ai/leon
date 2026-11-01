import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
  type RefObject
} from 'react'
import { clsx } from 'clsx'

import './scroll-container.sass'

export const SCROLL_CONTAINER_MASK_HEIGHT_PX = 32
const OVERFLOW_TOLERANCE_PX = 1

interface ScrollContainerProps extends HTMLAttributes<HTMLDivElement> {
  scrollRef?: RefObject<HTMLDivElement | null>
  viewportClassName?: string
}

/**
 * Gives scrollable content progressive edge fades while preserving the viewport
 * ref and scroll events needed by virtualizers and live-output followers.
 */
export function ScrollContainer({
  children,
  className,
  scrollRef,
  viewportClassName,
  style,
  ...viewportProps
}: ScrollContainerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const localScrollRef = useRef<HTMLDivElement>(null)
  const viewportRef = scrollRef ?? localScrollRef

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    const root = rootRef.current

    if (viewport === null || content === null || root === null) {
      return undefined
    }
    function updateMasks(): void {
      if (viewport === null || root === null) {
        return
      }

      const maximumScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      const fadeHeight = Math.max(1, Math.min(SCROLL_CONTAINER_MASK_HEIGHT_PX, viewport.clientHeight / 2))
      const top = Math.max(0, Math.min(viewport.scrollTop, maximumScroll))
      const overflowing = maximumScroll > OVERFLOW_TOLERANCE_PX

      root.style.setProperty('--scroll-container-top-opacity', String(
        overflowing ? Math.min(1, top / fadeHeight) : 0
      ))
      root.style.setProperty('--scroll-container-bottom-opacity', String(
        overflowing ? Math.min(1, (maximumScroll - top) / fadeHeight) : 0
      ))
    }

    // Content can resize independently of the viewport when virtual rows or
    // search results change. Neither needs a per-frame React render.
    const observer = new ResizeObserver(updateMasks)

    observer.observe(viewport)
    observer.observe(content)
    viewport.addEventListener('scroll', updateMasks, { passive: true })
    updateMasks()

    return () => {
      observer.disconnect()
      viewport.removeEventListener('scroll', updateMasks)
    }
  }, [viewportRef])

  return (
    <div
      ref={rootRef}
      className={clsx('scroll-container', className)}
      style={{ '--scroll-container-mask-height': `${SCROLL_CONTAINER_MASK_HEIGHT_PX}px`, ...style } as CSSProperties}
    >
      <div {...viewportProps} ref={viewportRef} className={clsx('scroll-container-viewport', viewportClassName)}>
        <div ref={contentRef} className="scroll-container-content">{children}</div>
      </div>
      <span className="scroll-container-mask scroll-container-mask-top" aria-hidden="true" />
      <span className="scroll-container-mask scroll-container-mask-bottom" aria-hidden="true" />
    </div>
  )
}

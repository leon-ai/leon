import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { useExitCleanup } from '@/hooks/use-exit-cleanup'

import './tooltip.sass'

export type TooltipPosition = 'top' | 'right' | 'bottom' | 'left'

interface TooltipProps {
  children: ReactNode
  hint?: ReactNode | (() => ReactNode)
  message: string | (() => string)
  position?: TooltipPosition
  className?: string
  multiline?: boolean
  blurOnClick?: boolean
  disabled?: boolean
}

const TOOLTIP_OFFSET = 8

function getTooltipStyle(
  triggerRect: DOMRect,
  position: TooltipPosition
): CSSProperties {
  if (position === 'top') {
    return {
      bottom: window.innerHeight - triggerRect.top + TOOLTIP_OFFSET,
      left: triggerRect.left + (triggerRect.width / 2)
    }
  }

  if (position === 'right') {
    return {
      top: triggerRect.top + (triggerRect.height / 2),
      left: triggerRect.right + TOOLTIP_OFFSET
    }
  }

  if (position === 'left') {
    return {
      top: triggerRect.top + (triggerRect.height / 2),
      right: window.innerWidth - triggerRect.left + TOOLTIP_OFFSET
    }
  }

  return {
    top: triggerRect.bottom + TOOLTIP_OFFSET,
    left: triggerRect.left + (triggerRect.width / 2)
  }
}

export function Tooltip({
  children,
  hint,
  message,
  position = 'bottom',
  className,
  multiline = false,
  blurOnClick = true,
  disabled = false
}: TooltipProps) {
  const [rendered, setRendered] = useState(false)
  const [open, setOpen] = useState(false)
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties>()
  const triggerRef = useRef<HTMLSpanElement>(null)
  const contentRef = useRef<HTMLSpanElement>(null)
  const [content, setContent] = useState<{ message: string, hint: ReactNode }>({ message: '', hint: null })
  useExitCleanup(contentRef, rendered && !open, () => setRendered(false))

  function openTooltip(): void {
    if (disabled || triggerRef.current === null) {
      return
    }

    setTooltipStyle(getTooltipStyle(
      triggerRef.current.getBoundingClientRect(),
      position
    ))
    setRendered(true)
    setContent({
      message: typeof message === 'function' ? message() : message,
      hint: typeof hint === 'function' ? hint() : hint
    })
    setOpen(true)
  }

  function closeTooltip(): void {
    setOpen(false)
  }

  function closeTooltipAndBlurTrigger(): void {
    closeTooltip()

    if (
      blurOnClick && document.activeElement instanceof HTMLElement &&
      triggerRef.current?.contains(document.activeElement)
    ) {
      document.activeElement.blur()
    }
  }

  useEffect(() => {
    if (!open || triggerRef.current === null) {
      return
    }

    function updateTooltipPosition(): void {
      if (triggerRef.current === null) {
        return
      }

      setTooltipStyle(getTooltipStyle(
        triggerRef.current.getBoundingClientRect(),
        position
      ))
    }

    updateTooltipPosition()
    window.addEventListener('resize', updateTooltipPosition)
    window.addEventListener('scroll', updateTooltipPosition, true)

    return () => {
      window.removeEventListener('resize', updateTooltipPosition)
      window.removeEventListener('scroll', updateTooltipPosition, true)
    }
  }, [open, position])

  return (
    <>
      <span
        ref={triggerRef}
        className={clsx('tooltip', className)}
        onMouseEnter={openTooltip}
        onMouseLeave={closeTooltip}
        onFocus={openTooltip}
        onBlur={closeTooltip}
        onClick={closeTooltipAndBlurTrigger}
      >
        {children}
      </span>
      {rendered && createPortal(
        <span
          ref={contentRef}
          className={clsx(
            'tooltip-content',
            `tooltip-content-${position}`,
            { 'tooltip-content-open': open, 'tooltip-content-multiline': multiline }
          )}
          role="tooltip"
          style={tooltipStyle}
        >
          <span className="tooltip-message">{typeof message === 'function' ? content.message : message}</span>
          {hint !== undefined && (
            <span className="tooltip-hint">{typeof hint === 'function' ? content.hint : hint}</span>
          )}
        </span>,
        document.body
      )}
    </>
  )
}

import type { ReactNode } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'

import { Button, type ButtonVariant } from '@/components/button'
import { useExitCleanup } from '@/hooks/use-exit-cleanup'

import './dialog.sass'

type DialogRole = 'dialog' | 'alertdialog'
type DialogSize = 'medium' | 'large' | 'wide'

interface DialogAction {
  label: string
  variant?: ButtonVariant
  onClick: () => void
}

interface DialogProps {
  footer?: ReactNode
  className?: string
  actions?: DialogAction[]
  children?: ReactNode
  closeOnOverlayClick?: boolean
  hideFooter?: boolean
  hideHeader?: boolean
  description?: ReactNode
  open: boolean
  centered?: boolean
  role?: DialogRole
  size?: DialogSize
  title: string
  onClose: () => void
  onAfterClose?: () => void
}

export function Dialog({
  className,
  actions = [],
  children,
  centered = false,
  closeOnOverlayClick = true,
  description,
  footer,
  hideFooter = false,
  hideHeader = false,
  open,
  role = 'dialog',
  size = 'medium',
  title,
  onClose,
  onAfterClose
}: DialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const [mounted, setMounted] = useState(open)
  const overlayRef = useRef<HTMLDivElement>(null)

  useExitCleanup(overlayRef, mounted && !open, () => {
    setMounted(false)
    onAfterClose?.()
  })

  useEffect(() => {
    if (open) {
      setMounted(true)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return undefined
    }

    const focusable = (): HTMLElement[] => Array.from(overlayRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'
    ) ?? []).filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'))
    const focusFrame = requestAnimationFrame(() => {
      // Content updates must not steal focus from an active dialog control.
      if (!overlayRef.current?.contains(document.activeElement)) {
        focusable()[0]?.focus({ preventScroll: true })
      }
    })

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      } else if (event.key === 'Tab') {
        const elements = focusable()
        const first = elements[0]
        const last = elements.at(-1)
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  if (!mounted) {
    return null
  }

  return createPortal(
    <div
      ref={overlayRef}
      className={clsx('dialog-overlay', {
        'dialog-overlay-open': open,
        'dialog-overlay-centered': centered
      })}
      onMouseDown={(event) => {
        if (closeOnOverlayClick && event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section
        className={clsx('dialog', `dialog-${size}`, className, { 'dialog-open': open })}
        role={role}
        aria-label={hideHeader ? title : undefined}
        aria-labelledby={hideHeader ? undefined : titleId}
        aria-describedby={description === undefined ? undefined : descriptionId}
        aria-modal="true"
      >
        {!hideHeader && (
          <header className="dialog-header">
            <h2 className="dialog-title" id={titleId}>
              {title}
            </h2>
            <Button
              iconName="close"
              tone="muted"
              ariaLabel="Close dialog"
              onClick={onClose}
            />
          </header>
        )}
        <div className="dialog-body">
          {description !== undefined && (
            <p className="dialog-description" id={descriptionId}>
              {description}
            </p>
          )}
          {children}
        </div>
        {!hideFooter && (footer !== undefined || actions.length > 0) && (
          <footer className="dialog-footer">
            {footer ?? actions.map((action) => (
              <Button
                key={action.label}
                variant={action.variant ?? 'ghost'}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ))}
          </footer>
        )}
      </section>
    </div>,
    document.body
  )
}

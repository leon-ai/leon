import type { ReactNode } from 'react'
import { useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'

import { Button, type ButtonVariant } from '../button'

import './dialog.sass'

type DialogRole = 'dialog' | 'alertdialog'
type DialogSize = 'medium' | 'large'

interface DialogAction {
  label: string
  variant?: ButtonVariant
  onClick: () => void
}

interface DialogProps {
  actions?: DialogAction[]
  children?: ReactNode
  closeOnOverlayClick?: boolean
  hideFooter?: boolean
  hideHeader?: boolean
  description?: ReactNode
  open: boolean
  role?: DialogRole
  size?: DialogSize
  title: string
  onClose: () => void
}

export function Dialog({
  actions = [],
  children,
  closeOnOverlayClick = true,
  description,
  hideFooter = false,
  hideHeader = false,
  open,
  role = 'dialog',
  size = 'medium',
  title,
  onClose
}: DialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const [mounted, setMounted] = useState(open)

  useEffect(() => {
    if (open) {
      setMounted(true)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return undefined
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  if (!mounted) {
    return null
  }

  return createPortal(
    <div
      className={clsx('dialog-overlay', {
        'dialog-overlay-open': open
      })}
      onTransitionEnd={(event) => {
        if (
          event.target === event.currentTarget &&
          event.propertyName === 'opacity' &&
          !open
        ) {
          setMounted(false)
        }
      }}
      onMouseDown={(event) => {
        if (closeOnOverlayClick && event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <section
        className={clsx('dialog', `dialog-${size}`, { 'dialog-open': open })}
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
        {!hideFooter && actions.length > 0 && (
          <footer className="dialog-footer">
            {actions.map((action) => (
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

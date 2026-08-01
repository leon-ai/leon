import type { CSSProperties, ReactNode } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'

import { Button } from '../button'

import './toast.sass'

type ToastType = 'success' | 'info' | 'warning' | 'error'

interface ToastInput {
  type?: ToastType
  title: string
  description: string
}

interface ToastItem extends Required<ToastInput> {
  exiting: boolean
  id: string
}

interface ToastContextValue {
  showToast: (toast: ToastInput) => void
}

interface ToastProviderProps {
  children: ReactNode
}

interface ToastCardProps {
  stackIndex: number
  toast: ToastItem
  toastCount: number
  onActivate: () => void
  onClose: (toastId: string) => void
  onExited: (toastId: string) => void
}

const DEFAULT_TOAST_DURATION_MS = 9_000
const MAX_STACKED_TOASTS = 3
const TOAST_ICONS: Record<ToastType, string> = {
  success: 'check-line',
  info: 'info-i',
  warning: 'alert-line',
  error: 'close-circle-line'
}
const ToastContext = createContext<ToastContextValue | null>(null)

function createToastId(): string {
  return window.crypto.randomUUID()
}

function ToastCard({
  stackIndex,
  toast,
  toastCount,
  onActivate,
  onClose,
  onExited
}: ToastCardProps) {
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      onClose(toast.id)
    }, DEFAULT_TOAST_DURATION_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [onClose, toast.id])

  return (
    <article
      className={clsx(
        'toast',
        `toast-${toast.type}`,
        `toast-stack-${stackIndex}`,
        { 'toast-hidden-stack': stackIndex >= MAX_STACKED_TOASTS },
        { 'toast-exiting': toast.exiting }
      )}
      style={{
        '--toast-index': stackIndex,
        zIndex: toastCount - stackIndex
      } as CSSProperties}
      onPointerEnter={onActivate}
      onFocus={onActivate}
      onTransitionEnd={(event) => {
        if (event.propertyName === 'opacity' && toast.exiting) {
          onExited(toast.id)
        }
      }}
    >
      <div className="toast-content-container">
        <div className="toast-header">
          <span className="toast-icon" aria-hidden="true">
            <i className={`toast-icon-symbol ri-${TOAST_ICONS[toast.type]}`} />
          </span>
          <strong className="toast-title">{toast.title}</strong>
        </div>
        <p className="toast-description">{toast.description}</p>
      </div>
      <div
        className="toast-close-button"
      >
        <Button
          iconName="close"
          tone="muted"
          ariaLabel="Close notification"
          onClick={() => onClose(toast.id)}
        />
      </div>
    </article>
  )
}

export function ToastProvider({
  children
}: ToastProviderProps) {
  const regionRef = useRef<HTMLElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const closeToast = useCallback((toastId: string): void => {
    setToasts((currentToasts) =>
      currentToasts.map((toast) =>
        toast.id === toastId
          ? { ...toast, exiting: true }
          : toast
      )
    )

  }, [])

  const removeToast = useCallback((toastId: string): void => {
    setToasts((currentToasts) =>
      currentToasts.filter((toast) => toast.id !== toastId)
    )
  }, [])

  useEffect(() => {
    if (!expanded) {
      return undefined
    }

    function handlePointerMove(event: PointerEvent): void {
      const region = regionRef.current

      if (region === null) {
        setExpanded(false)
        return
      }

      const regionRect = region.getBoundingClientRect()
      const isInsideRegion =
        event.clientX >= regionRect.left &&
        event.clientX <= regionRect.right &&
        event.clientY >= regionRect.top &&
        event.clientY <= regionRect.bottom

      if (!isInsideRegion) {
        setExpanded(false)
      }
    }

    document.addEventListener('pointermove', handlePointerMove)

    return () => {
      document.removeEventListener('pointermove', handlePointerMove)
    }
  }, [expanded])

  const contextValue = useMemo<ToastContextValue>(() => ({
    showToast: (toast) => {
      setToasts((currentToasts) => [
        {
          id: createToastId(),
          exiting: false,
          type: toast.type ?? 'info',
          title: toast.title,
          description: toast.description
        },
        ...currentToasts
      ])
    }
  }), [])

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {toasts.length > 0 && createPortal(
        <section
          ref={regionRef}
          className={clsx('toast-region', {
            'toast-region-expanded': expanded
          })}
          aria-label="Notifications"
          aria-live="polite"
          style={{
            '--toast-region-expanded-height': `calc((var(--toast-stack-item-height) * ${toasts.length}) + (var(--toast-stack-gap) * ${Math.max(toasts.length - 1, 0)}))`
          } as CSSProperties}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setExpanded(false)
            }
          }}
        >
          {toasts.map((toast, stackIndex) => (
            <ToastCard
              key={toast.id}
              stackIndex={stackIndex}
              toast={toast}
              toastCount={toasts.length}
              onActivate={() => setExpanded(true)}
              onClose={closeToast}
              onExited={removeToast}
            />
          ))}
        </section>,
        document.body
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const contextValue = useContext(ToastContext)

  if (contextValue === null) {
    throw new Error('useToast must be used within ToastProvider.')
  }

  return contextValue
}

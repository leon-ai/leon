import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'

import { useExitCleanup } from '@/hooks/use-exit-cleanup'

import './dropdown.sass'

type DropdownPlacement = 'top' | 'bottom'
type DropdownItemVariant = 'default' | 'danger'

interface DropdownItem {
  iconName: string
  label: string
  variant?: DropdownItemVariant
  onSelect?: () => void
}

interface DropdownProps {
  children: ReactNode | ((open: boolean, contentId: string) => ReactNode)
  items?: DropdownItem[]
  content?: (close: () => void, open: boolean) => ReactNode
  contentLabel?: string
  className?: string
  width?: number
  height?: number
  preferredPlacement?: DropdownPlacement
  disabled?: boolean
}

const DROPDOWN_OFFSET = 6
const DROPDOWN_WIDTH = 180
const DROPDOWN_ESTIMATED_ITEM_HEIGHT = 40
const DROPDOWN_VERTICAL_PADDING = 8

function getDropdownHeight(itemCount: number): number {
  return (itemCount * DROPDOWN_ESTIMATED_ITEM_HEIGHT) + DROPDOWN_VERTICAL_PADDING
}

function getDropdownPosition(
  triggerRect: DOMRect,
  dropdownWidth: number,
  estimatedHeight: number,
  preferredPlacement?: DropdownPlacement
): {
  placement: DropdownPlacement
  style: CSSProperties
} {
  const width = Math.min(dropdownWidth, window.innerWidth - DROPDOWN_OFFSET * 2)
  const spaceBelow = window.innerHeight - triggerRect.bottom
  const spaceAbove = triggerRect.top
  const placement = preferredPlacement === 'top'
    ? spaceAbove >= estimatedHeight + DROPDOWN_OFFSET || spaceAbove >= spaceBelow
      ? 'top' : 'bottom'
    : spaceBelow >= estimatedHeight + DROPDOWN_OFFSET || spaceBelow >= spaceAbove
      ? 'bottom' : 'top'
  const dropdownHeight = Math.min(
    estimatedHeight,
    Math.max(0, (placement === 'top' ? spaceAbove : spaceBelow) - DROPDOWN_OFFSET * 2)
  )
  const preferredTop = placement === 'bottom'
    ? triggerRect.bottom + DROPDOWN_OFFSET
    : triggerRect.top - dropdownHeight - DROPDOWN_OFFSET
  const top = Math.min(
    Math.max(preferredTop, DROPDOWN_OFFSET),
    window.innerHeight - dropdownHeight - DROPDOWN_OFFSET
  )
  const left = Math.min(
    Math.max(triggerRect.right - width, DROPDOWN_OFFSET),
    window.innerWidth - width - DROPDOWN_OFFSET
  )

  return {
    placement,
    style: {
      top,
      left,
      width,
      maxHeight: dropdownHeight
    }
  }
}

export function Dropdown({
  children,
  items = [],
  content,
  contentLabel,
  className,
  width = DROPDOWN_WIDTH,
  height,
  preferredPlacement,
  disabled = false
}: DropdownProps) {
  const contentId = useId()
  const triggerRef = useRef<HTMLSpanElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<DropdownPlacement>('bottom')
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>()

  useExitCleanup(dropdownRef, mounted && !open, () => setMounted(false))

  const updateDropdownPosition = useCallback((): void => {
    if (triggerRef.current === null) {
      return
    }

    const nextPosition = getDropdownPosition(
      triggerRef.current.getBoundingClientRect(),
      width,
      height ?? getDropdownHeight(items.length),
      preferredPlacement
    )

    if (height !== undefined) {
      nextPosition.style.height = nextPosition.style.maxHeight
    }

    setPlacement(nextPosition.placement)
    setDropdownStyle(nextPosition.style)
  }, [height, items.length, preferredPlacement, width])

  const closeDropdown = useCallback((restoreFocus = false): void => {
    if (!open) {
      return
    }

    if (restoreFocus || dropdownRef.current?.contains(document.activeElement)) {
      triggerRef.current?.querySelector<HTMLElement>('button, a')?.focus()
    }

    setOpen(false)
  }, [open])

  const openDropdown = useCallback((): void => {
    updateDropdownPosition()
    setMounted(true)
    setOpen(true)
  }, [updateDropdownPosition])

  function toggleDropdown(): void {
    if (disabled) {
      return
    }

    if (mounted && open) {
      closeDropdown()
      return
    }

    openDropdown()
  }

  useEffect(() => {
    if (disabled) {
      closeDropdown()
    }
  }, [closeDropdown, disabled])

  useEffect(() => {
    if (!open) {
      return undefined
    }

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target

      if (!(target instanceof Node)) {
        return
      }

      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) {
        return
      }

      closeDropdown()
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDropdown(true)
      }
    }

    function handleFocusIn(event: FocusEvent): void {
      if (
        event.target instanceof Node &&
        !triggerRef.current?.contains(event.target) &&
        !dropdownRef.current?.contains(event.target)
      ) {
        closeDropdown()
      }
    }

    updateDropdownPosition()
    const observer = new ResizeObserver(updateDropdownPosition)

    if (triggerRef.current !== null) {
      observer.observe(triggerRef.current)
    }

    // A layout transition may move the trigger without a resize or scroll.
    document.addEventListener('transitionend', updateDropdownPosition)
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('focusin', handleFocusIn)
    window.addEventListener('resize', updateDropdownPosition)
    window.addEventListener('scroll', updateDropdownPosition, true)

    return () => {
      observer.disconnect()
      document.removeEventListener('transitionend', updateDropdownPosition)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('focusin', handleFocusIn)
      window.removeEventListener('resize', updateDropdownPosition)
      window.removeEventListener('scroll', updateDropdownPosition, true)
    }
  }, [closeDropdown, open, updateDropdownPosition])

  return (
    <>
      <span
        ref={triggerRef}
        className="dropdown-trigger"
        onClick={(event) => {
          event.stopPropagation()
          toggleDropdown()
        }}
      >
        {typeof children === 'function' ? children(open, contentId) : children}
      </span>
      {mounted && createPortal(
        <div
          ref={dropdownRef}
          id={contentId}
          className={clsx(
            'dropdown-content',
            className,
            `dropdown-content-${placement}`,
            { 'dropdown-content-open': open }
          )}
          role={content === undefined ? 'menu' : 'dialog'}
          aria-label={contentLabel}
          aria-hidden={!open}
          inert={!open}
          style={dropdownStyle}
        >
          {content === undefined ? items.map((item) => (
            <button
              type="button"
              className={clsx(
                'dropdown-item',
                `dropdown-item-${item.variant ?? 'default'}`
              )}
              key={item.label}
              role="menuitem"
              onClick={() => {
                item.onSelect?.()
                closeDropdown(true)
              }}
            >
              <i
                className={`dropdown-item-icon ri-${item.iconName}-line`}
                aria-hidden="true"
              />
              <span className="dropdown-item-label">{item.label}</span>
            </button>
          )) : content(() => closeDropdown(true), open)}
        </div>,
        document.body
      )}
    </>
  )
}

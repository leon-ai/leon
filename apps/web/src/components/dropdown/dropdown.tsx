import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
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
  open?: boolean
  onOpenChange?: (open: boolean) => void
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

/**
 * Anchors a popup with local visibility or a controlled open/onOpenChange pair.
 * Closing content stays mounted until its own exit transition completes.
 */
export function Dropdown({
  children,
  items = [],
  content,
  contentLabel,
  className,
  width = DROPDOWN_WIDTH,
  height,
  preferredPlacement,
  disabled = false,
  open: controlledOpen,
  onOpenChange
}: DropdownProps) {
  const contentId = useId()
  const triggerRef = useRef<HTMLSpanElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const openedWithPointerRef = useRef(false)
  const [mounted, setMounted] = useState(false)
  const [isPointerFocusRestored, setIsPointerFocusRestored] = useState(false)
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const controlled = controlledOpen !== undefined
  const [placement, setPlacement] = useState<DropdownPlacement>('bottom')
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>()

  const setOpen = useCallback((next: boolean): void => {
    if (!controlled) {
      setInternalOpen(next)
    }

    onOpenChange?.(next)
  }, [controlled, onOpenChange])

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
      // Escape changes the browser's focus-visible heuristic, not the owner's
      // original input method. Keep keyboard restoration visible without a
      // lingering ring on a pointer-opened control.
      setIsPointerFocusRestored(openedWithPointerRef.current)
      triggerRef.current?.querySelector<HTMLElement>('button, a')?.focus({ preventScroll: true })
    }

    setOpen(false)
  }, [open, setOpen])

  // Controlled and local opening both position and mount before the next paint.
  useLayoutEffect(() => {
    if (open) {
      updateDropdownPosition()
      setMounted(true)
    }
  }, [open, updateDropdownPosition])

  function toggleDropdown(): void {
    if (disabled) {
      return
    }

    if (mounted && open) {
      closeDropdown()
      return
    }

    setOpen(true)
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
        className={clsx('dropdown-trigger', {
          'dropdown-trigger-pointer-focus': isPointerFocusRestored
        })}
        onBlurCapture={() => setIsPointerFocusRestored(false)}
        onKeyDownCapture={(event) => {
          if (event.key !== 'Escape') {
            setIsPointerFocusRestored(false)
          }
        }}
        onClick={(event) => {
          event.stopPropagation()
          openedWithPointerRef.current = event.detail > 0
          setIsPointerFocusRestored(false)
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
            { 'list-items': content === undefined },
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

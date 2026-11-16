import { useState, type ReactNode, type Ref } from 'react'

import { Dropdown } from '@/components/dropdown'
import { Input } from '@/components/input'
import { getListNavigationIndex } from '@/utils/list-navigation'

import './input-dropdown.sass'

const POPUP_HEIGHT = 320

interface InputDropdownProps {
  label: string
  fieldRef?: Ref<HTMLInputElement | HTMLTextAreaElement>
  value: string
  placeholder?: string
  disabled?: boolean
  onChange: (value: string) => void
  content: (close: () => void, open: boolean) => ReactNode
}

/**
 * Anchors browsable suggestions to a native field, sharing popup positioning,
 * dismissal and focus restoration with the application's other dropdowns.
 */
export function InputDropdown({ label, fieldRef, value, placeholder, disabled = false, onChange, content }: InputDropdownProps) {
  const [open, setOpen] = useState(false)

  return <Dropdown openOnFocus matchTriggerWidth height={POPUP_HEIGHT} contentLabel={label}
    className="input-dropdown" disabled={disabled} open={open} onOpenChange={setOpen}
    content={(close, visible) => <div className="input-dropdown-body" onKeyDown={(event) => {
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      const next = getListNavigationIndex(event, { count: buttons.length,
        currentIndex: buttons.indexOf(document.activeElement as HTMLButtonElement), loop: true })
      if (next !== undefined) {
        event.preventDefault()
        buttons[next]?.focus()
        buttons[next]?.scrollIntoView({ block: 'nearest' })
      }
    }}>{content(close, visible)}</div>}>
    {(visible, contentId) => <Input fieldRef={fieldRef ?? null} ariaLabel={label} value={value} placeholder={placeholder}
      autoComplete="off" disabled={disabled} aria-expanded={visible} aria-controls={visible ? contentId : undefined}
      aria-haspopup="dialog" onChange={(event) => {
        onChange(event.target.value)
        setOpen(true)
      }} onKeyDown={(event) => {
        if (visible && event.key === 'Enter') {
          // Browsing suggestions must not submit a surrounding form implicitly.
          event.preventDefault()
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          if (!visible) {
            setOpen(true)
          } else {
            document.getElementById(contentId)?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
          }
        }
      }} />}
  </Dropdown>
}

import { useMemo, useState } from 'react'
import { Combobox, createListCollection } from '@ark-ui/react/combobox'
import { useFilter } from '@ark-ui/react/locale'
import { ScrollContainer } from './scroll-container'
import { Button } from './button/button'
import { SELECTION_CHECK_PATH } from '../contracts/selection'

import './controls.sass'

const MAXIMUM_VISIBLE_OPTIONS = 24

export interface SearchSelectProps {
  label: string
  options: readonly { value: string, label: string, disabled?: boolean }[]
  value?: string[]
  defaultValue?: string[]
  multiple?: boolean
  disabled?: boolean
  name?: string
  onValueChange?: (value: string[]) => void
}

/**
 * Uses the installed combobox's focus/keyboard/selection behavior and bounds
 * the visible results rather than mounting an unbounded option list.
 */
export function SearchSelect({ label, options, value, defaultValue, multiple, disabled = false, name, onValueChange }: SearchSelectProps) {
  const [query, setQuery] = useState('')
  const [localValue, setLocalValue] = useState(defaultValue ?? [])
  const selected = value ?? localValue
  const { contains } = useFilter({ sensitivity: 'base' })
  const matches = useMemo(() => options.filter((option) => contains(option.label, query)), [options, contains, query])
  const visible = matches.slice(0, MAXIMUM_VISIBLE_OPTIONS)
  const filtered = useMemo(() => createListCollection({ items: [...visible] }), [visible])

  return <Combobox.Root className="aurora-search-select" collection={filtered}
    value={selected} multiple={multiple} disabled={disabled} name={name}
    onInputValueChange={(details) => setQuery(details.inputValue)}
    onValueChange={(details) => {
      setQuery('')
      setLocalValue(details.value)
      onValueChange?.(details.value)
    }}>
    <Combobox.Label className="aurora-control-label">{label}</Combobox.Label>
    {multiple && selected.length > 0 && <ul className="aurora-selection-summary" aria-label={`${label} selection`}>
      {options.filter((option) => selected.includes(option.value)).map((option) => <li key={option.value}>
        <Button size="sm" variant="secondary" ariaLabel={`Remove ${option.label}`} disabled={disabled}
          onClick={() => {
            const next = selected.filter((item) => item !== option.value)
            setLocalValue(next)
            onValueChange?.(next)
          }}>{option.label}</Button>
      </li>)}
    </ul>}
    <Combobox.Control><Combobox.Input className="input-field" placeholder="Search options…" /></Combobox.Control>
    <Combobox.Content className="aurora-select-popup">
      <ScrollContainer className="aurora-select-options">
        {visible.map((option) => <Combobox.Item key={option.value} item={option} className="aurora-select-option">
          <Combobox.ItemText>{option.label}</Combobox.ItemText>
          <Combobox.ItemIndicator aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d={SELECTION_CHECK_PATH} />
          </svg></Combobox.ItemIndicator>
        </Combobox.Item>)}
        {visible.length === 0 && <p className="aurora-feedback">No matching options.</p>}
      </ScrollContainer>
      {matches.length > MAXIMUM_VISIBLE_OPTIONS && <p className="aurora-feedback">Type more to narrow the results.</p>}
    </Combobox.Content>
  </Combobox.Root>
}

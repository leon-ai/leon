import type { InputHTMLAttributes, Ref } from 'react'
import { SELECTION_CHECK_PATH } from '../contracts/selection'

import './selection-control.sass'

/**
 * Retains the native event and focus target while owning the mark's geometry
 * and contrast independently of browser checkbox artwork.
 */
export function SelectionControl(props: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <span className="aurora-selection-control">
    <input {...props} />
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path className="aurora-selection-check" d={SELECTION_CHECK_PATH} />
    </svg>
  </span>
}

/**
 * Decorates an existing input without replacing its event target or resetting
 * checked state, listeners or its form association.
 */
export function decorateSelectionControl(input: HTMLInputElement): void {
  if (input.parentElement?.classList.contains('aurora-selection-control')) {
    return
  }

  const focused = document.activeElement === input
  const wrapper = document.createElement('span')
  wrapper.className = 'aurora-selection-control'
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('class', 'aurora-selection-check')
  path.setAttribute('d', SELECTION_CHECK_PATH)
  svg.append(path)
  input.before(wrapper)
  wrapper.append(input, svg)

  if (focused) {
    input.focus({ preventScroll: true })
  }
}

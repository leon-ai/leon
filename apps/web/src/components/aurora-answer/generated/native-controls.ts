import { BUTTON_VARIANTS, BUTTON_SIZES, CONTROL_LAYOUT_PROPERTIES,
  NATIVE_CONTROL_SELECTOR, NativeControlKind, getNativeControlKind } from '../../../../../../aurora/src/v2/contracts/controls'
import { getButtonClassName } from '../../../../../../aurora/src/v2/components/button/button'
import { decorateSelectionControl } from '../../../../../../aurora/src/v2/components/selection-control'

/**
 * Applies actual Aurora classes without replacing nodes, so generated DOM
 * listeners, labels, selection and native form behavior retain their identity.
 */
export function observeNativeControls(root: HTMLElement): () => void {
  const owned = new WeakMap<HTMLElement, Set<string>>()

  function adapt(element: HTMLElement): void {
    // These composite controls already own their native targets and keyboard
    // semantics; decorating them as standalone buttons/choices would split them.
    if (element.closest('.aurora-segments, .aurora-tab-list')) {
      return
    }

    const kind = getNativeControlKind(element.localName, element.getAttribute('type') ?? 'text')
    if (kind === NativeControlKind.None) {
      return
    }

    // Shared Input owns inline caret/reveal styles; the adapter must not undo them.
    const sharedInput = element.classList.contains('input-field') && element.closest('.input')
    if (!sharedInput) {
      for (const property of [...element.style]) {
        if (!CONTROL_LAYOUT_PROPERTIES.has(property)) {
          element.style.removeProperty(property)
        }
      }
    }

    const classes: string[] = []
    if (kind === NativeControlKind.Button) {
      if (element.classList.contains('button') && !owned.has(element)) {
        return
      }
      const variant = BUTTON_VARIANTS.find((value) => value === element.dataset['variant']) ?? 'secondary'
      const size = BUTTON_SIZES.find((value) => value === element.dataset['size']) ?? 'md'
      classes.push(...getButtonClassName({ variant, size }).split(' '))
      for (const value of [...BUTTON_VARIANTS.map((item) => `button-${item}`), ...BUTTON_SIZES.map((item) => `button-${item}`)]) {
        if (!classes.includes(value) && element.classList.contains(value)) {
          element.classList.remove(value)
        }
      }
    } else if (kind === NativeControlKind.Text || kind === NativeControlKind.Textarea) {
      classes.push('input-field')
      if (kind === NativeControlKind.Textarea) {
        classes.push('aurora-native-textarea')
      }
    } else if (kind === NativeControlKind.Select) {
      classes.push('aurora-native-select')
    } else if (kind === NativeControlKind.Choice) {
      classes.push('aurora-native-choice')
      decorateSelectionControl(element as HTMLInputElement)
      const label = element.closest('label')
      if (label && !label.classList.contains('aurora-choice')) {
        label.classList.add('aurora-choice')
      }
    } else if (kind === NativeControlKind.Range) {
      classes.push('aurora-range')
    }
    const previous = owned.get(element) ?? new Set<string>()
    for (const name of previous) {
      if (!classes.includes(name)) {
        element.classList.remove(name)
        previous.delete(name)
      }
    }
    for (const name of classes) {
      if (!element.classList.contains(name)) {
        element.classList.add(name)
        previous.add(name)
      }
    }
    owned.set(element, previous)
  }

  function visit(element: Element): void {
    if (element instanceof HTMLElement && element.matches(NATIVE_CONTROL_SELECTOR)) {
      adapt(element)
    }
    element.querySelectorAll<HTMLElement>(NATIVE_CONTROL_SELECTOR).forEach(adapt)
  }

  visit(root)
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof HTMLElement) {
        adapt(record.target)
      } else {
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            visit(node)
          }
        }
      }
    }
  })
  observer.observe(root, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['class', 'type', 'role', 'data-variant', 'data-size', 'style'] })

  return () => observer.disconnect()
}

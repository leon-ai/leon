export const BUTTON_VARIANTS = ['ghost', 'secondary', 'primary', 'danger'] as const
export const BUTTON_SIZES = ['sm', 'md'] as const
export const NATIVE_CONTROL_SELECTOR = 'button,input,textarea,select'

// Controls own their appearance. Generated layouts can position them without
// changing typography, hit areas, palette, borders or interaction feedback.
export const CONTROL_LAYOUT_PROPERTIES: ReadonlySet<string> = new Set([
  'display', 'position', 'inset', 'inset-block', 'inset-inline',
  'inset-block-start', 'inset-block-end', 'inset-inline-start', 'inset-inline-end',
  'top', 'right', 'bottom', 'left', 'width', 'max-width', 'inline-size', 'max-inline-size',
  'height', 'max-height', 'block-size', 'max-block-size',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'margin-block', 'margin-inline', 'margin-block-start', 'margin-block-end',
  'margin-inline-start', 'margin-inline-end', 'grid-area', 'grid-column',
  'grid-row', 'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end',
  'order', 'align-self', 'justify-self', 'place-self', 'flex', 'flex-basis',
  'flex-grow', 'flex-shrink', 'visibility', 'cursor'
])

export enum NativeControlKind {
  None = 'none',
  Button = 'button',
  Text = 'text',
  Textarea = 'textarea',
  Select = 'select',
  Choice = 'choice',
  Range = 'range'
}

/**
 * Shares native HTML control semantics between source checks and the browser
 * adapter without inferring intent from labels or replacing event targets.
 */
export function getNativeControlKind(tag: string, type = 'text'): NativeControlKind {
  if (tag === 'button') {
    return NativeControlKind.Button
  }
  if (tag === 'textarea') {
    return NativeControlKind.Textarea
  }
  if (tag === 'select') {
    return NativeControlKind.Select
  }
  if (tag !== 'input') {
    return NativeControlKind.None
  }

  switch (type.toLowerCase()) {
    case 'button':
    case 'submit':
    case 'reset':
      return NativeControlKind.Button
    case 'radio':
    case 'checkbox':
      return NativeControlKind.Choice
    case 'range':
      return NativeControlKind.Range
    case 'hidden':
    case 'color':
    case 'file':
    case 'image':
      return NativeControlKind.None
    default:
      return NativeControlKind.Text
  }
}

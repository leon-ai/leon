import { Script } from 'node:vm'
import { parseFragment, type DefaultTreeAdapterMap } from 'parse5'
import { isAuroraSpec, type AuroraSpec } from '@@/aurora/src/v2/contracts/answer'
import { BUTTON_VARIANTS, BUTTON_SIZES, getNativeControlKind, NativeControlKind } from '@@/aurora/src/v2/contracts/controls'
import { validateGeneratedStyles, type GeneratedStyleContext } from './design-contract'

const FORBIDDEN_ELEMENTS = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'base', 'meta', 'link'])
const RESOURCE_ATTRIBUTES = new Set(['src', 'srcset', 'href', 'action', 'formaction', 'poster', 'data', 'ping', 'xlink:href'])
const MAXIMUM_MARKUP_NODES = 2_048
const MAXIMUM_MARKUP_DEPTH = 48

/**
 * Checks bounded source without executing model code in Core. Browser layout and
 * runtime behavior are separate checks; syntax validation is not a security sandbox.
 */
export function validateGeneratedSurfaces(spec: AuroraSpec): string[] {
  if (!isAuroraSpec(spec)) {
    return ['Use a valid, bounded Aurora specification.']
  }
  const issues: string[] = []

  for (const [id, node] of Object.entries(spec.elements)) {
    if (node.type === 'Results') {
      issues.push(`${id}: Use Text with Markdown links instead of the retired Results widget.`)
      continue
    }
    if (node.type !== 'Generated') {
      continue
    }
    let count = 0
    const styles: GeneratedStyleContext = { classes: new Set(), ids: new Set(), inline: [] }
    const visit = (element: DefaultTreeAdapterMap['node'], depth: number, inMask = false): void => {
      count += 1
      if (count > MAXIMUM_MARKUP_NODES || depth > MAXIMUM_MARKUP_DEPTH) {
        throw new Error('Use fewer HTML elements and shallower nesting.')
      }
      const mask = inMask || 'tagName' in element && element.tagName === 'mask'
      if ('tagName' in element) {
        if (FORBIDDEN_ELEMENTS.has(element.tagName)) {
          throw new Error(`Put behavior in javascript, not a ${element.tagName} element. External resources and embedded documents are unavailable.`)
        }
        const attributes = new Map(element.attrs.map((attribute) => [attribute.name, attribute.value]))
        const control = getNativeControlKind(element.tagName, attributes.get('type')) !== NativeControlKind.None
        if (control) {
          for (const name of (attributes.get('class') ?? '').split(' ')) {
            if (name) {
              styles.classes.add(name)
            }
          }
          if (attributes.has('id')) {
            styles.ids.add(attributes.get('id')!)
          }
          if (attributes.has('data-variant') && !BUTTON_VARIANTS.some((value) => value === attributes.get('data-variant')) ||
            attributes.has('data-size') && !BUTTON_SIZES.some((value) => value === attributes.get('data-size'))) {
            throw new Error('Use supported Aurora data-variant and data-size values for controls.')
          }
        }
        if (element.tagName === 'style') {
          throw new Error('Put authored styles in css so the host can validate their design tokens.')
        }
        for (const attribute of element.attrs) {
          if (attribute.name.startsWith('on') || attribute.name === 'style' && attribute.value.includes('@import')) {
            throw new Error('Use javascript listeners and the css property, not inline event handlers or imports.')
          }
          if (attribute.name === 'style') {
            styles.inline.push({ css: attribute.value, control, mask })
          } else if (attribute.name === 'fill' || attribute.name === 'stroke' || attribute.name === 'color' || attribute.name === 'stop-color') {
            styles.inline.push({ css: `${attribute.name}:${attribute.value}`, control: false, mask })
          }
          if (RESOURCE_ATTRIBUTES.has(attribute.name) && attribute.value &&
            !attribute.value.startsWith('#') && !attribute.value.startsWith('data:image/')) {
            throw new Error('Use local DOM references or inline image data. Network destinations are unavailable inside generated surfaces.')
          }
        }
        if ('content' in element) {
          visit(element.content, depth + 1, mask)
        }
      }
      if ('childNodes' in element) {
        for (const child of element.childNodes) {
          visit(child, depth + 1, mask)
        }
      }
    }

    try {
      visit(parseFragment(node.props.html), 0)
      issues.push(...validateGeneratedStyles(node.props.css ?? '', styles).map((issue) => `${id}: ${issue}`))
      // Compilation detects broken JavaScript but deliberately never runs it in Node.
      new Script(`(async () => {\n${node.props.javascript ?? ''}\n})()`, { filename: `${id}.js` })
    } catch (error) {
      issues.push(`${id}: ${error instanceof Error ? error.message : 'Invalid generated source.'}`)
    }
  }

  return issues
}

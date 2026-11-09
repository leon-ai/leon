import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { CssNode, Declaration } from '@eslint/css-tree'
import { CODEBASE_PATH } from '@/leon-roots'
import { CONTROL_LAYOUT_PROPERTIES, NATIVE_CONTROL_SELECTOR } from '@@/aurora/src/v2/contracts/controls'

const TOKEN_SOURCES = ['variables.sass', 'themes.sass']
const TOKEN_PATHS = TOKEN_SOURCES.map((filename) => path.join(CODEBASE_PATH, 'aurora', 'src', 'v2', 'styles', filename))
const CONTROL_TAGS = new Set(NATIVE_CONTROL_SELECTOR.split(','))
const COLOR_EXCEPTIONS = new Set(['transparent', 'currentcolor'])
const FONT_PROPERTIES = new Set(['font', 'font-family', 'font-size', 'font-weight', 'line-height'])
const CSS_GLOBAL_VALUES = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer'])
const MAXIMUM_STYLE_ISSUES = 6
const require = createRequire(import.meta.url)
let cssTree: typeof import('@eslint/css-tree') | undefined
let tokenNames: ReadonlySet<string> | undefined
let tokenVersion = ''

function getCSS(): typeof import('@eslint/css-tree') {
  // Ordinary turns do not need the optional CSS grammar or color lexer.
  cssTree ??= require('@eslint/css-tree') as typeof import('@eslint/css-tree')

  return cssTree
}

/**
 * Reads the same custom-property declarations used by Aurora's Sass build.
 * Tokenization needs no Sass runtime and avoids a second handwritten registry.
 */
export function getAuroraTokenNames(): ReadonlySet<string> {
  const version = TOKEN_PATHS.map((filename) => {
    const stats = fs.statSync(filename)

    return `${stats.mtimeMs}:${stats.size}`
  }).join('|')
  if (tokenNames && tokenVersion === version) {
    return tokenNames
  }
  const { tokenize, tokenTypes } = getCSS()
  const names = new Set<string>()
  for (const filename of TOKEN_PATHS) {
    const source = fs.readFileSync(filename, 'utf8')
    let previous: string | undefined
    tokenize(source, (type, start, end) => {
      if (type === tokenTypes['WhiteSpace'] || type === tokenTypes['Comment']) {
        return
      }
      if (previous && type === tokenTypes['Colon']) {
        names.add(previous)
      }
      const value = source.slice(start, end)
      const prefix = source.slice(source.lastIndexOf('\n', start) + 1, start)
      previous = type === tokenTypes['Ident'] && value.startsWith('--') && !prefix.trim() ? value : undefined
    })
  }
  tokenNames = names
  tokenVersion = version

  return names
}

export interface GeneratedStyleContext {
  classes: Set<string>
  ids: Set<string>
  inline: Array<{ css: string, control: boolean, mask?: boolean }>
}

function targetsControl(selector: CssNode, context: GeneratedStyleContext): boolean {
  const { walk } = getCSS()
  let matched = false
  walk(selector, function (node) {
    if (node.type === 'PseudoClassSelector' && (node.name === 'has' || node.name === 'not')) {
      return this.skip
    }
    if (node.type === 'TypeSelector' && CONTROL_TAGS.has(node.name.toLowerCase()) ||
      node.type === 'ClassSelector' && (context.classes.has(node.name) || node.name === 'button' || node.name === 'input-field') ||
      node.type === 'IdSelector' && context.ids.has(node.name)) {
      matched = true
    }

    return undefined
  })

  return matched
}

/**
 * Rejects invented palette values, unavailable tokens and authored control skins
 * before publication. Layout geometry and token-based content styling stay open.
 * This is design validation, not an adversarial JavaScript security boundary.
 */
export function validateGeneratedStyles(css: string, context: GeneratedStyleContext): string[] {
  const { parse, walk, generate, lexer } = getCSS()
  const issues = new Set<string>()
  const tokens = getAuroraTokenNames()
  const reservedFamilies = new Set([...tokens].map((name) => name.split('-')[2]))
  const onParseError = (error: Error): never => {
    throw error
  }
  const trees = [{ tree: parse(css, { parseCustomProperty: true, onParseError }), control: false, mask: false },
    ...context.inline.map((item) => ({ tree: parse(item.css, { context: 'declarationList', parseCustomProperty: true, onParseError }), control: item.control, mask: item.mask ?? false }))]
  const local = new Set<string>()
  for (const { tree } of trees) {
    walk(tree, { visit: 'Declaration', enter(node) {
      if (node.type === 'Declaration' && node.property.startsWith('--') && !tokens.has(node.property)) {
        local.add(node.property)
      }
    } })
  }

  function declaration(node: Declaration, control: boolean, mask: boolean): void {
    const property = node.property.toLowerCase()
    if (tokens.has(property)) {
      issues.add(`Do not redefine Aurora token ${property}; use its existing value.`)
    } else if (property.startsWith('--') && reservedFamilies.has(property.split('-')[2])) {
      issues.add(`Unknown Aurora token ${property}; do not invent tokens in the shared design namespace.`)
    }
    if (node.important) {
      issues.add('Remove !important; shared Aurora control styles must retain their priority.')
    }
    if (control && !CONTROL_LAYOUT_PROPERTIES.has(property) && !property.startsWith('--')) {
      issues.add(`Do not restyle control ${property}. Use Aurora components or data-variant/data-size; position controls through layout wrappers.`)
    }
    const value = node.value.type === 'Raw' ? parse(node.value.value, { context: 'value' }) : node.value
    let themed = false
    walk(value, (child) => {
      if (child.type === 'Function' && child.name.toLowerCase() === 'var') {
        const name = child.children.first
        if (name?.type === 'Identifier') {
          if (tokens.has(name.name)) {
            themed = true
          } else if (!local.has(name.name)) {
            issues.add(`Unknown Aurora token ${name.name}. Use an exact supported token; declare local geometry variables before referencing them.`)
          }
        }
      }
      // Coverage masks are not palette colors. Other paint comes from tokens,
      // including SVG presentation attributes and gradient stops.
      if (!mask && !property.startsWith('mask') && (child.type === 'Hash' ||
        (child.type === 'Identifier' || child.type === 'Function') &&
        !('name' in child && COLOR_EXCEPTIONS.has(child.name.toLowerCase())) &&
        lexer.matchType('color', generate(child)).matched !== null)) {
        issues.add(`Use Aurora color tokens instead of ${generate(child)} in ${property}.`)
      }
    })
    const text = generate(value)
    if (property.startsWith('--') && themed) {
      issues.add(`Use design tokens directly instead of introducing alias ${property}; local variables are for geometry/state.`)
    }
    if (FONT_PROPERTIES.has(property) && !themed && !CSS_GLOBAL_VALUES.has(text) && text !== '0') {
      issues.add(`Use an Aurora font/line-height token for ${property}.`)
    }
    if (property.includes('radius') && !themed && text !== '0' && text !== '50%') {
      issues.add('Use --border-radius-* tokens for corner radii.')
    }
  }

  for (const { tree, control, mask } of trees) {
    walk(tree, {
      enter(node) {
        if (node.type === 'Atrule' && (node.name === 'layer' || node.name === 'import' || node.name === 'font-face' || node.name === 'property')) {
          issues.add(`The host owns @${node.name}; use the supplied Aurora styles and local fonts.`)
        }
        if (node.type === 'Declaration') {
          declaration(node, control || Boolean(this.rule?.prelude && targetsControl(this.rule.prelude, context)), mask)
        }
      }
    })
  }

  return [...issues].slice(0, MAXIMUM_STYLE_ISSUES)
}

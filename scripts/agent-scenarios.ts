import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SCENARIOS_DIRECTORY = fileURLToPath(new URL('../test/agent/scenarios/', import.meta.url))
const SCENARIO_SUFFIX = '.scenario.ts'
const SUITE_SUFFIX = '-scenarios'

/**
 * Discover real scenarios recursively, keeping identifiers relative to their root.
 */
export function listAgentScenarios(directory = SCENARIOS_DIRECTORY): string[] {
  const root = fs.realpathSync(directory)
  const names: string[] = []

  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) {
        visit(file)
      } else if (entry.isFile() && entry.name.endsWith(SCENARIO_SUFFIX)) {
        names.push(path.relative(root, file).slice(0, -SCENARIO_SUFFIX.length).split(path.sep).join('/'))
      }
    }
  }
  // Ignore symlinks so discovery cannot escape the source tree or follow cycles.
  visit(root)

  return names.sort()
}

/**
 * Resolve a category, mechanism or individual case; reject ambiguous short names.
 */
export function selectAgentScenarios(names: string[], selector = '*'): string[] {
  if (selector === '*') {
    return names
  }

  const targets = new Map<string, string[]>()
  for (const name of names) {
    const parts = name.split('/')
    for (let length = 1; length <= parts.length; length += 1) {
      const key = parts.slice(0, length).join('/')
      targets.set(key, [...(targets.get(key) ?? []), name])
    }
  }

  const exact = targets.get(selector)
  if (exact) {
    return exact
  }

  const matches = [...targets.keys()].filter((key) => {
    const segment = key.split('/').at(-1)!
    return segment === selector || segment.endsWith(SUITE_SUFFIX) &&
      segment.slice(0, -SUITE_SUFFIX.length) === selector
  })
  if (matches.length !== 1) {
    throw new Error(matches.length
      ? `Ambiguous scenario selection "${selector}". Use one of: ${matches.join(', ')}`
      : `Unknown scenario selection "${selector}". Use --list to see available suites and cases.`)
  }

  return targets.get(matches[0]!)!
}

/**
 * Resolve only discovered source files, never arbitrary caller-supplied paths.
 */
export function resolveAgentScenario(name: string): string {
  if (!listAgentScenarios().includes(name)) {
    throw new Error(`Unknown real scenario: ${name}`)
  }

  return path.join(SCENARIOS_DIRECTORY, `${name}${SCENARIO_SUFFIX}`)
}

import fs from 'node:fs/promises'
import path from 'node:path'
import execa from 'execa'

import type { ProviderScenarioId } from './provider-scenarios'

const OWNER_FILES = ['owner-staged.txt', 'owner-unstaged.txt', 'owner-untracked.txt']

export interface CodingEvidence {
  baselineFailed: boolean
  testsPassed: boolean
  protectedFilesPreserved: boolean
  stagedDiffPreserved: boolean
  headPreserved: boolean
  sessionsStopped?: boolean
  changedFiles: string[]
}

export interface CodingFixture {
  root: string
  allowedChanges: string[]
  verify: () => Promise<CodingEvidence>
}

/**
 * Build a small real repository with failing tests and pre-existing owner work.
 */
export async function createCodingFixture(
  root: string,
  scenarioId: ProviderScenarioId
): Promise<CodingFixture> {
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  const multipleFiles = scenarioId === 'coding_multiple_files'
  const session = scenarioId === 'coding_session'
  const sources = multipleFiles
    ? {
        'src/price.mjs': 'export function discountedTotal(values, discount) {\n  return values.reduce((sum, value) => sum + value, 0) * discount\n}\n',
        'src/receipt.mjs': 'export function formatReceipt(amount) {\n  return `Total: ${amount}`\n}\n'
      }
    : session
      ? { 'src/greeting.mjs': 'export function greet(name) {\n  return `HELLO ${name}`\n}\n' }
      : { 'src/math.mjs': 'export function add(left, right) {\n  return left - right\n}\n' }
  const test = multipleFiles
    ? 'import { discountedTotal } from \'./src/price.mjs\'\nimport { formatReceipt } from \'./src/receipt.mjs\'\ntest(\'receipt\', () => { assert.equal(formatReceipt(discountedTotal([100, 200], 0.1)), \'Total: 270.00\') })\n'
    : session
      ? 'import { greet } from \'./src/greeting.mjs\'\ntest(\'greeting\', () => { assert.equal(greet(\'Ada\'), \'Hello, Ada!\') })\n'
      : 'import { add } from \'./src/math.mjs\'\ntest(\'addition\', () => { assert.equal(add(2, 3), 5); assert.equal(add(-2, 3), 1) })\n'
  const files: Record<string, string> = {
    ...sources,
    'AGENTS.md': '# Project instructions\nUse pnpm for project commands. Reproduce the failing test before editing. Do not edit package.json, tests, instruction files or owner files. Preserve existing staged, unstaged and untracked work. Do not stage or commit.\n',
    'src/AGENTS.md': '# Source instructions\nUse named exports. Keep changes limited to the requested functions. Use two-space indentation.\n',
    'package.json': `${JSON.stringify({
      private: true,
      type: 'module',
      scripts: { test: 'node --test fixture.test.mjs', ...(session ? { dev: 'node interactive.mjs' } : {}) }
    }, null, 2)}\n`,
    'fixture.test.mjs': `import test from 'node:test'\nimport assert from 'node:assert/strict'\n${test}`,
    'owner-staged.txt': 'original staged file\n',
    'owner-unstaged.txt': 'original unstaged file\n'
  }
  if (session) {
    files['interactive.mjs'] = [
      'import { createInterface } from \'node:readline\'',
      'const input = createInterface({ input: process.stdin })',
      'console.log(\'SESSION_READY\')',
      'input.on(\'line\', async (name) => {',
      '  const { greet } = await import(\'./src/greeting.mjs?version=\' + Date.now())',
      '  console.log(greet(name))',
      '})',
      ''
    ].join('\n')
  }

  await Promise.all(Object.entries(files).map(([name, content]) =>
    fs.writeFile(path.join(root, name), content)
  ))
  const git = (args: string[]): Promise<execa.ExecaReturnValue<string>> => execa('git', args, { cwd: root })
  await git(['init', '--quiet'])
  await git(['add', '.'])
  await git([
    '-c', 'user.name=Leon Test',
    '-c', 'user.email=test@example.invalid',
    '-c', 'commit.gpgsign=false',
    '-c', `core.hooksPath=${path.join(root, '.git', 'hooks')}`,
    'commit', '--quiet', '-m', 'fixture'
  ])
  files['owner-staged.txt'] = 'owner staged change\n'
  files['owner-unstaged.txt'] = 'owner unstaged change\n'
  files['owner-untracked.txt'] = 'owner untracked work\n'
  for (const name of OWNER_FILES) {
    await fs.writeFile(path.join(root, name), files[name]!)
  }
  await git(['add', 'owner-staged.txt'])
  const stagedDiff = (await git(['diff', '--cached', '--binary'])).stdout
  const head = (await git(['rev-parse', 'HEAD'])).stdout
  const baseline = await execa(process.execPath, ['--test', 'fixture.test.mjs'], { cwd: root, reject: false })
  if (baseline.exitCode === 0) {
    throw new Error('Coding fixture must fail before the agent starts.')
  }

  const allowedChanges = Object.keys(sources)
  return {
    root,
    allowedChanges,
    verify: async (): Promise<CodingEvidence> => {
      const checked = await execa(process.execPath, ['--test', 'fixture.test.mjs'], { cwd: root, reject: false })
      const preserved = await Promise.all(Object.entries(files)
        .filter(([name]) => !allowedChanges.includes(name))
        .map(async ([name, content]) => fs.readFile(path.join(root, name), 'utf8')
          .then((current) => current === content, () => false)))
      const changed = (await git(['diff', '--name-only', 'HEAD'])).stdout.split('\n').filter(Boolean)
      const untracked = (await git(['ls-files', '--others', '--exclude-standard'])).stdout.split('\n').filter(Boolean)

      return {
        baselineFailed: baseline.exitCode !== 0,
        testsPassed: checked.exitCode === 0,
        protectedFilesPreserved: preserved.every(Boolean) && untracked.length === 1
          && untracked[0] === 'owner-untracked.txt',
        stagedDiffPreserved: (await git(['diff', '--cached', '--binary'])).stdout === stagedDiff,
        headPreserved: (await git(['rev-parse', 'HEAD'])).stdout === head,
        changedFiles: changed.filter((name) => !OWNER_FILES.includes(name)).sort()
      }
    }
  }
}

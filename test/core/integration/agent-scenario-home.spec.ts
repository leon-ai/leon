import fs from 'node:fs/promises'
import path from 'node:path'

import { execa } from 'execa'
import { afterEach, expect, it, vi } from 'vitest'

import { withAgentScenarioHome } from '../../agent/scenario-home'

afterEach(() => {
  vi.restoreAllMocks()
})

it.each([false, true])('removes SQLite fixtures after their child exits (scenario fails: %s)', async (fails) => {
  let home = ''
  const failure = new Error('The scenario did not produce its expected answer.')
  const run = withAgentScenarioHome(async (directory) => {
    home = directory
    const child = execa(process.execPath, ['--input-type=module', '-e', `
      import Database from 'better-sqlite3'
      const db = new Database(process.argv[1])
      db.exec('CREATE TABLE observations (value TEXT)')
      process.stdout.write('ready\\n')
      process.stdin.once('data', () => process.exit(0))
    `, path.join(home, 'index.sqlite')], { stdin: 'pipe' })

    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout!.once('data', () => resolve())
        void child.then(() => reject(new Error('The child exited before opening SQLite.')), reject)
      })
      expect((await fs.stat(path.join(home, 'index.sqlite'))).isFile()).toBe(true)
    } finally {
      child.stdin!.end('exit')
      await child
    }

    if (fails) {
      throw failure
    }

    return 'Verified observation.'
  })

  if (fails) {
    await expect(run).rejects.toBe(failure)
  } else {
    await expect(run).resolves.toBe('Verified observation.')
  }

  await expect(fs.stat(home)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('reports the original scenario failure alongside a fixture deletion failure', async () => {
  const failure = new Error('The scenario could not complete its task.')
  const cleanupFailure = Object.assign(new Error('Fixture is locked.'), { code: 'EBUSY' })
  const remove = fs.rm.bind(fs)
  let home = ''
  vi.spyOn(fs, 'rm').mockRejectedValueOnce(cleanupFailure)

  try {
    const error = await withAgentScenarioHome(async (directory) => {
      home = directory
      throw failure
    }).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).errors).toEqual([failure, cleanupFailure])
  } finally {
    await remove(home, { recursive: true, force: true })
  }
})

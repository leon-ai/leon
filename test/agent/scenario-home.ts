import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const AGENT_SCENARIO_HOME_PREFIX = 'leon-agent-e2e-'
const CLEANUP_MAX_RETRIES = 3

/**
 * Keep fixture deletion in the parent after the scenario child has exited and
 * released SQLite handles. Callbacks must await their child before returning.
 */
export async function withAgentScenarioHome<T>(
  run: (home: string) => Promise<T>
): Promise<T> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), AGENT_SCENARIO_HOME_PREFIX))
  let result!: T
  let failed = false
  let failure: unknown

  try {
    result = await run(home)
  } catch (error) {
    failed = true
    failure = error
  }

  try {
    await fs.rm(home, { recursive: true, force: true, maxRetries: CLEANUP_MAX_RETRIES })
  } catch (error) {
    if (failed) {
      throw new AggregateError([failure, error], 'The scenario and fixture cleanup both failed.')
    }

    throw error
  }

  if (failed) {
    throw failure
  }

  return result
}

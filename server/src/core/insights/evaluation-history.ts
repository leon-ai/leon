import fs from 'node:fs/promises'
import path from 'node:path'

import { getProfilePaths } from '@/core/profile-runtime/profile-paths'

import type { EvaluationRun } from './insights-contract'

const REPORT_FILE_PATTERN = /^[a-f0-9]{64}\.json$/

/**
 * Returns the retained evaluation runs for the authenticated profile.
 */
export async function readLocalEvaluations(): Promise<EvaluationRun[]> {
  const root = path.join(getProfilePaths().logs, 'evaluations')
  let names: string[]

  try {
    names = await fs.readdir(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }
    throw error
  }

  const reports: EvaluationRun[] = []
  for (const name of names) {
    if (REPORT_FILE_PATTERN.test(name)) {
      const content = await fs.readFile(path.join(root, name), 'utf8')
      reports.push(JSON.parse(content) as EvaluationRun)
    }
  }

  return reports.sort((first, second) => second.recordedAt - first.recordedAt)
}

import path from 'node:path'

import { GITHUB_URL, LEON_HOME_PATH } from '@/constants'
import { createReleaseSource } from '@/core/ota/release-source'

import type { EvaluationRun } from './insights-contract'
import { readLocalEvaluations } from './evaluation-history'
import { isEvaluationIndex, type EvaluationIndex } from './evaluation-index-schema'
import { QUICK_EVAL_INDEX_LIMIT, QUICK_EVAL_INDEX_URL } from './evaluation-report.js'

const MISSING_INDEX_CACHE_MS = 5 * 60_000
const source = createReleaseSource(path.join(LEON_HOME_PATH, 'cache', 'evaluations'), {
  maximumResponseBytes: QUICK_EVAL_INDEX_LIMIT,
  validateData: isEvaluationIndex
})
let pending: Promise<EvaluationIndex | undefined> | undefined
let missingUntil = 0

async function refreshIndex(): Promise<EvaluationIndex | undefined> {
  if (missingUntil > Date.now()) {
    return source.cached(QUICK_EVAL_INDEX_URL)
  }
  pending ??= source<EvaluationIndex>(QUICK_EVAL_INDEX_URL).catch((error: unknown) => {
    if ((error as { upstreamStatus?: number })?.upstreamStatus !== 404) {
      throw error
    }
    // A repository has no evaluation index until its first archive run.
    missingUntil = Date.now() + MISSING_INDEX_CACHE_MS
    return source.cached<EvaluationIndex>(QUICK_EVAL_INDEX_URL)
  }).finally(() => {
    pending = undefined
  })
  return pending
}

/**
 * Combines cached public benchmarks with this profile's existing local reports.
 * The shared index is fetched at most once per refresh across active profiles.
 */
export async function readEvaluationHistory(refresh: boolean): Promise<EvaluationRun[]> {
  const [index, local] = await Promise.all([
    refresh ? refreshIndex() : source.cached<EvaluationIndex>(QUICK_EVAL_INDEX_URL),
    readLocalEvaluations()
  ])
  const runs = index?.runs ?? []
  const published = new Set(runs.map(({ sha, recordedAt }) => `${sha}/${recordedAt}`))
  return [
    ...runs.map((run) => ({ ...run, runUrl: `${GITHUB_URL}/actions/runs/${run.runId}` })),
    ...local.filter(({ sha, recordedAt }) => !published.has(`${sha}/${recordedAt}`))
  ].sort((first, second) => second.recordedAt - first.recordedAt)
}

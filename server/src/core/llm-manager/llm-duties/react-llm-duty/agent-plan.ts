import type { OpenAITool } from '@/core/llm-manager/types'

import type { PlanStepStatus, TrackedPlanCollection, TrackedPlanStep } from './types'

const PLAN_STATUSES = ['pending', 'in_progress', 'completed', 'error'] as const

/** Checks recorded coverage and outcomes as well as visible step statuses. */
export function isAgentPlanComplete(steps: TrackedPlanStep[]): boolean {
  return steps.every((step) => step.status === 'completed' &&
    (!step.collection || (step.collection.enumeration === 'completed' &&
      Boolean(step.collection.evidence) && step.collection.items.every((item) =>
        item.status === 'completed' && Boolean(item.details)))))
}

function readStatus(value: unknown): PlanStepStatus {
  if (!PLAN_STATUSES.includes(value as PlanStepStatus)) throw new Error('Invalid plan status.')
  return value as PlanStepStatus
}

function readText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Missing plan text.')
  return value.trim()
}

function readCollection(value: unknown, previous?: TrackedPlanCollection): TrackedPlanCollection {
  const collection = value as TrackedPlanCollection
  const scope = readText(collection.scope)
  if (!['in_progress', 'completed'].includes(collection.enumeration) ||
      !Array.isArray(collection.items)) throw new Error('Invalid collection.')
  const evidence = readText(collection.evidence)
  const items = new Map(previous?.items.map((item) => [item.id, { ...item }]))
  const updatedIds = new Set<string>()
  for (const item of collection.items) {
    const id = readText(item.id)
    if (updatedIds.has(id)) throw new Error('Duplicate collection item.')
    updatedIds.add(id)
    const status = readStatus(item.status)
    const details = item.details == null ? items.get(id)?.details : readText(item.details)
    if (items.get(id)?.status === 'completed' && status !== 'completed' &&
        (!item.details || details === items.get(id)?.details)) {
      throw new Error('Reopening verified work requires new contradictory evidence.')
    }
    if (status === 'completed' && !details) throw new Error('Completed items require outcome evidence.')
    // Discover the relevant collection before execution, while still allowing
    // already-verified items to survive a later coverage correction.
    if (collection.enumeration !== 'completed' && status !== 'pending' &&
        items.get(id)?.status !== status) throw new Error('Finish enumeration before processing items.')
    items.set(id, { id, status, ...(details ? { details } : {}) })
  }
  return {
    scope, enumeration: collection.enumeration, evidence,
    ...(typeof collection.cursor === 'string' ? { cursor: collection.cursor.trim() } :
      previous?.cursor ? { cursor: previous.cursor } : {}),
    items: [...items.values()]
  }
}

/** Merges item deltas without losing recorded outcomes when a plan is replaced. */
export function parseAgentPlan(input: string, previous: TrackedPlanStep[]): TrackedPlanStep[] | null {
  try {
    const parsed = JSON.parse(input)
    if (!Array.isArray(parsed.steps) || !parsed.steps.length) return null
    const labels = new Set<string>()
    const steps: TrackedPlanStep[] = parsed.steps.map((step: TrackedPlanStep) => {
      const label = readText(step.label)
      if (labels.has(label)) throw new Error('Duplicate plan label.')
      labels.add(label)
      const prior = previous.find((entry) => entry.label === label)
      const details = step.details == null ? prior?.details : readText(step.details)
      const collection = step.collection == null ? prior?.collection : readCollection(step.collection, prior?.collection)
      const next = {
        label, status: readStatus(step.status),
        ...(details ? { details } : {}),
        ...(collection ? { collection: structuredClone(collection) } : {})
      }
      if (next.status === 'completed' && !isAgentPlanComplete([next])) {
        throw new Error('Collection coverage or outcomes are incomplete.')
      }
      return next
    })
    // A renamed or omitted collection step must not silently erase its ledger.
    if (previous.some((step) => step.collection && !labels.has(step.label))) return null
    return steps
  } catch {
    return null
  }
}

/** Uses the existing plan tool for both visible milestones and durable collection state. */
export function createAgentPlanTool(name: string): OpenAITool {
  return {
    type: 'function',
    function: {
      name,
      description: 'Track a multi-step task. For collection work, establish scope and enumerate the relevant source before processing items. Keep collection step labels stable. Item updates merge by id; send only changed items. No work is executed by this tool.',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array', minItems: 1,
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: 'Short verb-first user-facing step label. Keep collection labels stable.' },
                status: { type: 'string', enum: [...PLAN_STATUSES] },
                details: { type: 'string', description: 'Evidence, decisions and remaining work for this milestone.' },
                collection: {
                  type: 'object',
                  description: 'Attach to the end-to-end collection work step, which stays active until its items are verified. Omission preserves previous state. Items merge by stable source id, not list position or temporary UI handles.',
                  properties: {
                    scope: { type: 'string', description: 'Requested boundaries, authoritative source and desired outcome.' },
                    enumeration: { type: 'string', enum: ['in_progress', 'completed'] },
                    evidence: { type: 'string', description: 'Observed coverage: relevant filters, pages/cursors and end condition. Record empty ranges explicitly; do not invent missing items.' },
                    cursor: { type: 'string', description: 'Current source/list position or continuation; empty when no continuation remains.' },
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string', description: 'Stable source identity; retain the same id across revisits.' },
                          status: { type: 'string', enum: [...PLAN_STATUSES] },
                          details: { type: 'string', description: 'Observed identity/location, or verified outcome and artifact path when completed.' }
                        },
                        required: ['id', 'status'], additionalProperties: false
                      }
                    }
                  },
                  required: ['scope', 'enumeration', 'evidence', 'items'], additionalProperties: false
                }
              },
              required: ['label', 'status'], additionalProperties: false
            }
          }
        },
        required: ['steps'], additionalProperties: false
      }
    }
  }
}

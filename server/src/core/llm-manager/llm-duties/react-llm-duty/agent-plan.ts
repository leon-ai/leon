import type { OpenAITool } from '@/core/llm-manager/types'

import type { PlanStepStatus, TrackedPlanCollection, TrackedPlanStep } from './agent-types'

const PLAN_STATUSES = ['pending', 'in_progress', 'completed', 'error'] as const

// Keep collection workflow details out of unrelated requests. The first plan
// update activates these instructions before the next operational turn.
export const AGENT_PLAN_GUIDANCE = `<planning>
- Before complex or collection work, call update_plan; simple tasks need none. Record authoritative source pointers, boundaries, navigation, acceptance criteria and checks concisely in step details; reference existing artifacts instead of repeating source summaries or drafting outputs there. Start one step in_progress and later actionable steps pending. Inspect relevant lists/pages before unrelated app areas.
- Before processing a collection, attach it to a plan step. Record stable source identities, pagination/scroll coverage and the observed end condition; filtered snippets are not full lists. Complete enumeration only after covering scope, recording empty ranges explicitly. Keep the step in_progress until every item is verified, even after enumeration ends. Record verified exclusions and reasons as completed outcomes; omit them from deliverables unless requested. Bound unbounded sources explicitly and justify the boundary.
- Use the supplied source's metadata/version unless the owner requests latest. For exact exports, use that page's native export and preserve format/fields; never substitute sources or reconstruct it.
- For research, record questions, authoritative source boundaries and evidence gaps in step details. Inspect the bounded source inventory before selecting examples. Broaden or change methods when inspection adds no relevant evidence; distinguish runtime behavior from written guidance. Resolve each question with evidence or a precise limitation.
- Save verified outputs progressively. For files, cover all requested sections concisely before expanding detail; mark unresolved gaps and fill them in small writes. Reserve time for assembly/checks and prioritize unmet criteria over settled questions. Use elapsed time to meet supplied deadlines; diagnostic observation times are not task limits.
- Execute the worklist. On each verified milestone, call update_plan: complete the current step and, when work remains, set the next in_progress and include its operational call in the same response. At the final milestone, reconcile the plan without inventing another action. Do not start/report later work with a stale plan or batch historical completions at final reconciliation. Updates merge steps by stable label and items by id; send changes only. Omitted steps/collections retain state/order; new steps append. Plans and UI input success are not completion evidence. Revisit discovery only when new evidence changes scope; preserve completed outcomes and observed empty ranges. Before answering, reconcile the active step and every criterion against final-source evidence; unmet or unverified criteria remain unfinished.
</planning>`

/**
 * Checks recorded coverage and outcomes as well as visible step statuses.
 */
export function isAgentPlanComplete(steps: TrackedPlanStep[]): boolean {
  return steps.every((step) => {
    if (step.status !== 'completed') {
      return false
    }

    if (!step.collection) {
      return true
    }

    return (
      step.collection.enumeration === 'completed' &&
      Boolean(step.collection.evidence) &&
      step.collection.items.every(
        (item) => item.status === 'completed' && Boolean(item.details)
      )
    )
  })
}

function readStatus(value: unknown): PlanStepStatus {
  if (!PLAN_STATUSES.includes(value as PlanStepStatus)) {
    throw new Error('Invalid plan status.')
  }

  return value as PlanStepStatus
}

function readText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Missing plan text.')
  }

  return value.trim()
}

function readCollection(
  value: unknown,
  previous?: TrackedPlanCollection
): TrackedPlanCollection {
  const collection = value as TrackedPlanCollection
  const scope = readText(collection.scope)

  if (
    !['in_progress', 'completed'].includes(collection.enumeration) ||
    !Array.isArray(collection.items)
  ) {
    throw new Error('Invalid collection.')
  }

  const evidence = readText(collection.evidence)
  const items = new Map(previous?.items.map((item) => [item.id, { ...item }]))
  const updatedIds = new Set<string>()

  for (const item of collection.items) {
    const id = readText(item.id)

    if (updatedIds.has(id)) {
      throw new Error('Duplicate collection item.')
    }

    updatedIds.add(id)

    const status = readStatus(item.status)
    const details = item.details == null
      ? items.get(id)?.details
      : readText(item.details)

    if (
      items.get(id)?.status === 'completed' &&
      status !== 'completed' &&
      (!item.details || details === items.get(id)?.details)
    ) {
      throw new Error('Reopening verified work requires new contradictory evidence.')
    }

    if (status === 'completed' && !details) {
      throw new Error('Completed items require outcome evidence.')
    }

    // Discover the relevant collection before execution, while still allowing
    // already-verified items to survive a later coverage correction.
    if (
      collection.enumeration !== 'completed' &&
      status !== 'pending' &&
      items.get(id)?.status !== status
    ) {
      throw new Error('Finish enumeration before processing items.')
    }

    items.set(id, { id, status, ...(details ? { details } : {}) })
  }

  return {
    scope,
    enumeration: collection.enumeration,
    evidence,
    ...(typeof collection.cursor === 'string'
      ? { cursor: collection.cursor.trim() }
      : previous?.cursor ? { cursor: previous.cursor } : {}),
    items: [...items.values()]
  }
}

/**
 * Merges step and item deltas while preserving recorded outcomes and step order.
 */
export function parseAgentPlan(
  input: string,
  previous: TrackedPlanStep[]
): TrackedPlanStep[] | null {
  try {
    const parsed = JSON.parse(input)

    if (!Array.isArray(parsed.steps) || !parsed.steps.length) {
      return null
    }

    const labels = new Set<string>()
    const steps = new Map(
      previous.map((step) => [step.label, structuredClone(step)])
    )

    for (const step of parsed.steps as TrackedPlanStep[]) {
      const label = readText(step.label)

      if (labels.has(label)) {
        throw new Error('Duplicate plan label.')
      }

      labels.add(label)

      const prior = steps.get(label)
      const details = step.details == null ? prior?.details : readText(step.details)
      const collection = step.collection == null
        ? prior?.collection
        : readCollection(step.collection, prior?.collection)
      const next = {
        label,
        status: readStatus(step.status),
        ...(details ? { details } : {}),
        ...(collection ? { collection: structuredClone(collection) } : {})
      }

      if (next.status === 'completed' && !isAgentPlanComplete([next])) {
        throw new Error('Collection coverage or outcomes are incomplete.')
      }

      // Existing keys keep their positions, so partial or reordered updates
      // cannot shift the step identities used by the widget and durable trace.
      steps.set(label, next)
    }

    return [...steps.values()]
  } catch {
    return null
  }
}

/**
 * Uses the existing plan tool for both visible milestones and durable collection state.
 */
export function createAgentPlanTool(
  name: string,
  includeCollection = false
): OpenAITool {
  return {
    type: 'function',
    function: {
      name,
      description: includeCollection
        ? 'Send concise status/evidence deltas, referencing existing sources or artifacts instead of repeating their content. Steps merge by stable label; items by stable id. Omit unchanged steps, details and collections.'
        : 'Initialize complex or collection work before execution: put acceptance criteria and required checks in step details, start one step in_progress and later steps pending. Loads planning guidance and the collection schema for the next turn.',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            description: 'Changed or new steps. Omitted steps keep their state and order; new steps append to the plan.',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                label: {
                  type: 'string',
                  description: 'Short verb-first user-facing step label. Keep the same label when updating an existing step.'
                },
                status: {
                  type: 'string',
                  enum: [...PLAN_STATUSES]
                },
                details: {
                  type: 'string',
                  description: 'Concise criteria/checks and observed outcomes or remaining gaps. Reference evidence by path/id; do not draft deliverables or repeat source summaries. Omit unchanged details.'
                },
                ...(includeCollection
                  ? {
                      collection: {
                        type: 'object',
                        description: 'Attach to the end-to-end collection work step, which stays active until its items are verified. Omission preserves previous state. Items merge by stable source id, not list position or temporary UI handles.',
                        properties: {
                          scope: {
                            type: 'string',
                            description: 'Requested boundaries, authoritative source and desired outcome.'
                          },
                          enumeration: {
                            type: 'string',
                            enum: ['in_progress', 'completed']
                          },
                          evidence: {
                            type: 'string',
                            description: 'Observed coverage: relevant filters, pages/cursors and end condition. Record empty ranges explicitly; do not invent missing items.'
                          },
                          cursor: {
                            type: 'string',
                            description: 'Current source/list position or continuation; empty when no continuation remains.'
                          },
                          items: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                id: {
                                  type: 'string',
                                  description: 'Stable source identity; retain the same id across revisits.'
                                },
                                status: {
                                  type: 'string',
                                  enum: [...PLAN_STATUSES]
                                },
                                details: {
                                  type: 'string',
                                  description: 'Observed identity/location, or verified outcome and artifact path when completed.'
                                }
                              },
                              required: ['id', 'status'],
                              additionalProperties: false
                            }
                          }
                        },
                        required: ['scope', 'enumeration', 'evidence', 'items'],
                        additionalProperties: false
                      }
                    }
                  : {})
              },
              required: ['label', 'status'],
              additionalProperties: false
            }
          }
        },
        required: ['steps'],
        additionalProperties: false
      }
    }
  }
}

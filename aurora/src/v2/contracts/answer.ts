import { Type, type Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { generatedSourceProperties, MAXIMUM_GENERATED_SOURCE_CHARACTERS } from './generated'
import { presentationNodes, retiredPresentationNodes, isPresentationData } from './presentation'

export const MAXIMUM_UI_NODES = 32
export const MAXIMUM_UI_DEPTH = 8
export const MAXIMUM_ANSWER_UI_CHARACTERS = 262_144
const MAXIMUM_NATIVE_SPEC_CHARACTERS = 32_768
export const MAXIMUM_UI_SURFACES = 4
export const MAXIMUM_UI_SUBMISSION_CHARACTERS = 16_384
const MAXIMUM_UI_REPAIR_ERRORS = 3
const CLARIFICATION_INPUT_ID = 'input'
const RESERVED_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype))
const identifier = Type.String({ minLength: 1, maxLength: 80 })
const label = Type.String({ minLength: 1, maxLength: 256 })
const description = Type.Optional(Type.String({ maxLength: 1_024 }))
const FIELD_TYPES = ['text', 'email', 'number', 'date', 'time', 'textarea', 'select'] as const
const choice = Type.Object({ value: identifier, label, description }, { additionalProperties: false })
const options = Type.Array(choice, { minItems: 1, maxItems: 24 })
const field = Type.Object({
  name: identifier, label,
  type: Type.Union(FIELD_TYPES.map((value) => Type.Literal(value))),
  required: Type.Optional(Type.Boolean()),
  placeholder: Type.Optional(Type.String({ maxLength: 256 })),
  initialValue: Type.Optional(Type.String({ maxLength: 4_096 })),
  options: Type.Optional(options)
}, { additionalProperties: false })

const inputNodes = [
  Type.Object({ type: Type.Literal('BooleanChoice'), props: Type.Object({ title: label, description }, { additionalProperties: false }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('Choice'), props: Type.Object({ title: label, description, options,
    multiple: Type.Optional(Type.Boolean()) }, { additionalProperties: false }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('Form'), props: Type.Object({ title: label, description,
    fields: Type.Array(field, { minItems: 1, maxItems: 24 }) }, { additionalProperties: false }) }, { additionalProperties: false })
]

export const auroraInputSchema = Type.Union(inputNodes)
const nativeNodes = [
  Type.Object({ type: Type.Literal('Stack'), props: Type.Object({}, { additionalProperties: false }),
    children: Type.Array(identifier, { minItems: 1, maxItems: MAXIMUM_UI_NODES }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('Text'), props: Type.Object({ text: Type.String({ maxLength: 8_192 }) }, { additionalProperties: false }) }, { additionalProperties: false }),
  ...inputNodes,
  ...presentationNodes,
  Type.Object({ type: Type.Literal('Artifacts'), props: Type.Object({ title: label,
    artifactIds: Type.Array(identifier, { minItems: 1, maxItems: 12, uniqueItems: true }) }, { additionalProperties: false }) }, { additionalProperties: false })
]
const nodes = [
  ...nativeNodes,
  Type.Object({ type: Type.Literal('Generated'), props: Type.Object({
    title: label, description, ...generatedSourceProperties,
    fields: Type.Optional(Type.Array(field, { minItems: 1, maxItems: 24 }))
  }, { additionalProperties: false }) }, { additionalProperties: false })
]

export const auroraSpecSchema = Type.Object({
  root: identifier,
  elements: Type.Record(Type.String(), Type.Union([...nodes, ...retiredPresentationNodes]), { minProperties: 1, maxProperties: MAXIMUM_UI_NODES })
}, { additionalProperties: false })

/**
 * Exposes only supported nodes to generation while the replay schema also
 * accepts retired nodes retained in existing conversations.
 */
export const auroraAuthoringSpecSchema = Type.Object({
  ...auroraSpecSchema.properties,
  elements: Type.Record(Type.String(), Type.Union(nodes), { minProperties: 1, maxProperties: MAXIMUM_UI_NODES })
}, { additionalProperties: false })

/**
 * Supplies native visual contracts without loading generated-source authoring.
 */
export const auroraNativeSpecSchema = Type.Object({
  ...auroraSpecSchema.properties,
  elements: Type.Record(Type.String(), Type.Union(nativeNodes), { minProperties: 1, maxProperties: MAXIMUM_UI_NODES })
}, { additionalProperties: false })

export type AuroraSpec = Static<typeof auroraSpecSchema>
export type AuroraNode = AuroraSpec['elements'][string]
export type AuroraValues = boolean | string[] | Record<string, string>

/**
 * Turns declared clarification input into a native surface without another
 * inference or a second model-authored rendering specification.
 */
export function createAuroraInputSpec(input: unknown): AuroraSpec | null {
  if (!Value.Check(auroraInputSchema, input)) {
    return null
  }
  const spec = { root: CLARIFICATION_INPUT_ID, elements: { [CLARIFICATION_INPUT_ID]: input } }

  return isAuroraSpec(spec) ? spec : null
}

export interface AuroraReceipt {
  commandId: string
  revision: number
  values: AuroraValues
  submittedAt: number
}

export interface AuroraSurface {
  id: string
  revision: number
  status: 'draft' | 'ready'
  purpose: 'answer' | 'clarification'
  ownerMessageId?: string
  spec: AuroraSpec
  receipts: Record<string, AuroraReceipt>
}

export type AnswerPart =
  | { id: string, kind: 'ui', surface: AuroraSurface }
  | { id: string, kind: 'text', text: string }
  | { id: string, kind: 'artifacts', artifactIds: string[] }

/**
 * Accepts bounded presentation trees without native expressions, arbitrary
 * events, cycles or shared children. Executable source is confined to the
 * explicitly declared Generated node and its isolated renderer.
 */
export function isAuroraSpec(value: unknown): value is AuroraSpec {
  if (!Value.Check(auroraSpecSchema, value) || JSON.stringify(value).length > MAXIMUM_ANSWER_UI_CHARACTERS) {
    return false
  }

  const visited = new Set<string>()
  const spec = value
  const generated = Object.values(spec.elements).filter((node) => node.type === 'Generated')
  if ((!generated.length && JSON.stringify(spec).length > MAXIMUM_NATIVE_SPEC_CHARACTERS) ||
    generated.some((node) => JSON.stringify(node).length > MAXIMUM_GENERATED_SOURCE_CHARACTERS)) {
    return false
  }

  function visit(id: string, depth: number): boolean {
    if (visited.has(id) || RESERVED_KEYS.has(id) || id.length > 80 || depth > MAXIMUM_UI_DEPTH ||
      !Object.hasOwn(spec.elements, id)) {
      return false
    }

    visited.add(id)
    const node = spec.elements[id]!
    if ((node.type === 'Results' || node.type === 'DataTable' || node.type === 'Comparison' || node.type === 'Chart') && !isPresentationData(node)) {
      return false
    }
    if (node.type === 'Choice' && new Set(node.props.options.map((option) => option.value)).size !== node.props.options.length) {
      return false
    }
    const fields = node.type === 'Form' || node.type === 'Generated' ? node.props.fields : undefined
    if (fields && (new Set(fields.map((item) => item.name)).size !== fields.length ||
      fields.some((item) => RESERVED_KEYS.has(item.name) || item.type === 'select' && (!item.options?.length ||
        new Set(item.options.map((option) => option.value)).size !== item.options.length)))) {
      return false
    }

    return node.type !== 'Stack' || node.children.every((child) => visit(child, depth + 1))
  }

  return visit(value.root, 1) && visited.size === Object.keys(value.elements).length
}

/**
 * Describes the matching node's schema errors instead of every union
 * alternative, so a model can repair a surface without dropping the interface.
 */
export function describeAuroraSpecError(value: unknown): string {
  const problem = Value.Errors(auroraSpecSchema, value).First()
  if (!problem) {
    return 'Use a bounded tree with unique IDs, valid child references, choices and fields. Use credential-free web links, complete table/comparison cells and chart series aligned with every category (one nonnegative series for pie).'
  }

  const nodeType = problem.value && typeof problem.value === 'object' && 'type' in problem.value
    ? problem.value.type : undefined
  const schema = nodes.find((node) => node.properties.type.const === nodeType)
  if (schema) {
    const issues = []
    for (const error of Value.Errors(schema, problem.value)) {
      issues.push(`${problem.path}${error.path}: ${error.message}`)
      if (issues.length === MAXIMUM_UI_REPAIR_ERRORS) {
        break
      }
    }

    return issues.join('; ')
  }

  return `${problem.path || '/'}: ${problem.message}`
}

/**
 * Checks owner values against the saved node, not against client-supplied schemas.
 */
export function isAuroraSubmission(node: AuroraNode, value: unknown, mode: 'submit' | 'draft' = 'submit'): value is AuroraValues {
  if ((JSON.stringify(value)?.length ?? 0) > MAXIMUM_UI_SUBMISSION_CHARACTERS) {
    return false
  }
  if (node.type === 'BooleanChoice') {
    return typeof value === 'boolean'
  }
  if (node.type === 'Choice') {
    return Array.isArray(value) && (value.length > 0 || mode === 'draft') &&
      (node.props.multiple || value.length === 1) && new Set(value).size === value.length &&
      value.every((item) => typeof item === 'string' && node.props.options.some((option) => option.value === item))
  }
  if ((node.type !== 'Form' && node.type !== 'Generated') || !node.props.fields || !value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const values = value as Record<string, unknown>
  return Object.keys(values).length === node.props.fields.length && node.props.fields.every((item) => {
    const entry = values[item.name]

    return Object.hasOwn(values, item.name) && typeof entry === 'string' && entry.length <= 4_096 &&
      (mode === 'draft' || !item.required || entry.trim().length > 0) &&
      (item.type !== 'number' || entry === '' || Number.isFinite(Number(entry))) &&
      (item.type !== 'select' || !entry && (mode === 'draft' || !item.required) || item.options?.some((option) => option.value === entry))
  })
}

/**
 * Gives retries a stable representation independent of form-key or selection order.
 */
export function normalizeAuroraSubmission(node: AuroraNode, value: AuroraValues): AuroraValues {
  if (node.type === 'Choice') {
    return node.props.options.filter((option) => (value as string[]).includes(option.value)).map((option) => option.value)
  }
  if ((node.type === 'Form' || node.type === 'Generated') && node.props.fields) {
    return Object.fromEntries(node.props.fields.map((item) => [item.name, (value as Record<string, string>)[item.name]!]))
  }

  return value
}

/**
 * Produces a readable owner message while keeping control metadata out of prompts.
 */
export function auroraSubmissionText(node: AuroraNode, values: AuroraValues): string {
  if (node.type === 'BooleanChoice') {
    return `${node.props.title}\n${values ? 'Yes' : 'No'}`
  }
  if (node.type === 'Choice') {
    return `${node.props.title}\n${node.props.options.filter((option) => (values as string[]).includes(option.value))
      .map((option) => option.label).join(', ')}`
  }
  if ((node.type === 'Form' || node.type === 'Generated') && node.props.fields) {
    return `${node.props.title}\n${node.props.fields.map((item) => `${item.label}: ${(values as Record<string, string>)[item.name]}`).join('\n')}`
  }

  throw new Error('This component does not accept a submission.')
}

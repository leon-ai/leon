import { Type, type Static } from '@sinclair/typebox'

export const PRESENTATION_PAGE_SIZE = 12
export const MAXIMUM_PRESENTATION_ROWS = 128
const title = Type.String({ minLength: 1, maxLength: 256 })
const key = Type.String({ minLength: 1, maxLength: 80 })
const description = Type.Optional(Type.String({ maxLength: 1_024 }))
const cell = Type.Union([Type.String({ maxLength: 1_024 }), Type.Number(), Type.Boolean(), Type.Null()])
const column = Type.Object({ key, label: title }, { additionalProperties: false })
const values = Type.Record(Type.String(), cell, { maxProperties: 12 })

const resultListProperties = {
  title, description,
  items: Type.Array(Type.Object({
    id: key, title, description,
    url: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
    source: Type.Optional(title)
  }, { additionalProperties: false }), { minItems: 1, maxItems: 24 })
}

export const dataTableProperties = {
  title, description,
  columns: Type.Array(column, { minItems: 1, maxItems: 12 }),
  rows: Type.Array(Type.Object({ id: key, values }, { additionalProperties: false }), { maxItems: MAXIMUM_PRESENTATION_ROWS }),
  searchable: Type.Optional(Type.Boolean()),
  sortable: Type.Optional(Type.Boolean())
}

export const comparisonProperties = {
  title, description,
  criteria: Type.Array(column, { minItems: 1, maxItems: 12 }),
  options: Type.Array(Type.Object({ id: key, title, values }, { additionalProperties: false }), { minItems: 2, maxItems: 4 })
}

export const chartProperties = {
  title, description,
  kind: Type.Union([Type.Literal('bar'), Type.Literal('line'), Type.Literal('pie')]),
  categories: Type.Array(title, { minItems: 1, maxItems: 96 }),
  series: Type.Array(Type.Object({ label: title, values: Type.Array(Type.Number(), { minItems: 1, maxItems: 96 }) },
    { additionalProperties: false }), { minItems: 1, maxItems: 4 }),
  unit: Type.Optional(Type.String({ maxLength: 40 }))
}

// Stored answers retain their original shape even when a node leaves the authoring catalog.
export const retiredPresentationNodes = [
  Type.Object({ type: Type.Literal('Results'), props: Type.Object(resultListProperties, { additionalProperties: false }) }, { additionalProperties: false })
]

export const presentationNodes = [
  Type.Object({ type: Type.Literal('DataTable'), props: Type.Object(dataTableProperties, { additionalProperties: false }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('Comparison'), props: Type.Object(comparisonProperties, { additionalProperties: false }) }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('Chart'), props: Type.Object(chartProperties, { additionalProperties: false }) }, { additionalProperties: false })
]

export type PresentationNode = Static<typeof presentationNodes[number] | typeof retiredPresentationNodes[number]>
export type RetiredResultsData = Extract<PresentationNode, { type: 'Results' }>['props']
export type DataTableData = Extract<PresentationNode, { type: 'DataTable' }>['props']
export type ComparisonData = Extract<PresentationNode, { type: 'Comparison' }>['props']
export type ChartData = Extract<PresentationNode, { type: 'Chart' }>['props']

/**
 * Restricts result navigation to explicit, credential-free web destinations.
 */
export function isPresentationURL(value: string): boolean {
  try {
    const url = new URL(value)

    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
  } catch {
    return false
  }
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

/**
 * Checks relationships that JSON schemas cannot express: aligned chart series,
 * unique identities, safe links and complete table/comparison cells.
 */
export function isPresentationData(node: PresentationNode): boolean {
  if (node.type === 'Results') {
    return unique(node.props.items.map((item) => item.id)) &&
      node.props.items.every((item) => !item.url || isPresentationURL(item.url))
  }
  if (node.type === 'Chart') {
    return unique(node.props.series.map((series) => series.label)) &&
      node.props.series.every((series) => series.values.length === node.props.categories.length && series.values.every(Number.isFinite)) &&
      (node.props.kind !== 'pie' || node.props.series.length === 1 && node.props.series[0]!.values.every((value) => value >= 0))
  }

  const columns = node.type === 'DataTable' ? node.props.columns : node.props.criteria
  const rows = node.type === 'DataTable' ? node.props.rows : node.props.options

  return unique(columns.map((column) => column.key)) && unique(rows.map((row) => row.id)) &&
    rows.every((row) => Object.keys(row.values).length === columns.length &&
      columns.every((column) => Object.hasOwn(row.values, column.key) &&
        (typeof row.values[column.key] !== 'number' || Number.isFinite(row.values[column.key]))))
}

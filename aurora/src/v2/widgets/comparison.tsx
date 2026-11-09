import { useMemo, useState } from 'react'
import { Switch } from '../components/switch'
import type { ComparisonData } from '../contracts/presentation'
import { DataTableWidget } from './data-table'

/**
 * Compares the same declared criteria across options, with a local differences
 * filter that never selects, purchases or changes an option on the owner's behalf.
 */
export function ComparisonWidget({ title, description, criteria, options }: ComparisonData) {
  const [differences, setDifferences] = useState(false)
  const columns = useMemo(() => [
    { key: 'criterion', label: 'Feature' },
    ...options.map((option, index) => ({ key: `option-${index}`, label: option.title }))
  ], [options])
  const rows = useMemo(() => criteria.filter((criterion) => !differences ||
    new Set(options.map((option) => option.values[criterion.key])).size > 1).map((criterion) => ({
    id: criterion.key,
    values: Object.fromEntries([['criterion', criterion.label], ...options.map((option, index) => [`option-${index}`, option.values[criterion.key]!])])
  })), [criteria, options, differences])

  return <div className="aurora-presentation-stack">
    <Switch label="Only differences" checked={differences} onChange={(event) => setDifferences(event.target.checked)} />
    <DataTableWidget title={title} {...(description === undefined ? {} : { description })}
      columns={columns} rows={rows} searchable={false} sortable={false} />
  </div>
}

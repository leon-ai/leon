import { useMemo, useState } from 'react'
import { useFilter } from '@ark-ui/react/locale'
import { Button } from '../components/button/button'
import { Input } from '../components/input/input'
import { ScrollContainer } from '../components/scroll-container'
import { Surface } from '../components/surface'
import { Pagination } from '../components/pagination'
import { PRESENTATION_PAGE_SIZE, type DataTableData } from '../contracts/presentation'

import './presentation.sass'

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Bounds table DOM with pagination, preserving native table semantics and
 * horizontal scrolling instead of nesting a tall vertical viewport in the feed.
 */
export function DataTableWidget({ title, description, columns, rows, searchable = true, sortable = true }: DataTableData) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [sort, setSort] = useState<{ key: string, descending: boolean }>()
  const { contains } = useFilter({ sensitivity: 'base' })
  const results = useMemo(() => {
    const matches = searchable && query ? rows.filter((row) => contains(columns.map((column) => String(row.values[column.key] ?? '')).join(' '), query)) : [...rows]
    if (sortable && sort) {
      matches.sort((left, right) => {
        const a = left.values[sort.key]
        const b = right.values[sort.key]
        const order = typeof a === 'number' && typeof b === 'number' ? a - b : COLLATOR.compare(String(a ?? ''), String(b ?? ''))

        return sort.descending ? -order : order
      })
    }

    return matches
  }, [rows, columns, searchable, query, sortable, sort, contains])
  const pages = Math.max(1, Math.ceil(results.length / PRESENTATION_PAGE_SIZE))
  const currentPage = Math.min(page, pages - 1)
  const visible = results.slice(currentPage * PRESENTATION_PAGE_SIZE, (currentPage + 1) * PRESENTATION_PAGE_SIZE)

  return <Surface title={title} {...(description === undefined ? {} : { description })}
    footer={pages > 1 && <Pagination label={title} page={currentPage} pages={pages} onPageChange={setPage} />}>
    {searchable && <Input type="search" ariaLabel={`Search ${title}`} placeholder="Find in this table…" value={query}
      onChange={(event) => {
        setQuery(event.target.value)
        setPage(0)
      }} />}
    <ScrollContainer className="aurora-table-scroll" tabIndex={0} role="region" aria-label={`${title} table`}>
      <table className="aurora-data-table">
        <caption className="aurora-visually-hidden">{title}</caption>
        <thead><tr>{columns.map((column) => <th scope="col" key={column.key}
          aria-sort={sort?.key === column.key ? sort.descending ? 'descending' : 'ascending' : undefined}>
          {sortable ? <Button size="sm" ariaLabel={`Sort by ${column.label}`} onClick={() => {
            setSort({ key: column.key, descending: sort?.key === column.key && !sort.descending })
            setPage(0)
          }}>{column.label}{sort?.key === column.key ? sort.descending ? ' ↓' : ' ↑' : ''}</Button> : column.label}
        </th>)}</tr></thead>
        <tbody>{visible.map((row) => <tr key={row.id}>{columns.map((column) => <td key={column.key}>
          {row.values[column.key] === null ? '—' : typeof row.values[column.key] === 'boolean'
            ? row.values[column.key] ? 'Yes' : 'No' : String(row.values[column.key] ?? '')}
        </td>)}</tr>)}</tbody>
      </table>
    </ScrollContainer>
    {results.length === 0 && <p role="status" className="aurora-feedback">No matching rows.</p>}
  </Surface>
}

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import { Button } from '@/components/button'
import { Input } from '@/components/input'
import { Loader } from '@/components/loader'
import { ScrollList } from '@/components/scroll-list'
import { createSearchIndex, searchIndex } from '@/utils/search'
import { MaintenanceBadge } from './catalog-identity'
import { PackageIcon } from '@/components/package-icon/package-icon'
import type { CatalogPresentation } from '../../../../../server/src/core/catalog/types'
import './catalog-list.sass'

interface CatalogRow extends CatalogPresentation {
  id: string
  name: string
  description: string
  iconName: string
  kind: string
  installed: boolean
  enabled: boolean
}

interface CatalogListProps<T extends CatalogRow> {
  entries: T[]
  category: 'tools' | 'skills'
  loading: boolean
  error: boolean
  onRetry: () => void
  onDetails: (entry: T) => void
  state: (entry: T) => string
  actions: (entry: T) => ReactNode
  toolbar?: ReactNode
}

/**
 * Bounds catalog DOM and shares search, filters, branding and maintenance
 * presentation without coupling tool transport to skill execution.
 */
export function CatalogList<T extends CatalogRow>({ entries, category, loading, error, onRetry, onDetails, state, actions, toolbar }: CatalogListProps<T>) {
  const viewport = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [installedOnly, setInstalledOnly] = useState(false)
  const index = useMemo(() => createSearchIndex(entries, (entry) =>
    [entry.name, entry.id, entry.description, entry.kind]), [entries])
  const filtered = useMemo(() => searchIndex(index, query).map(({ item }) => item)
    .filter((entry) => !installedOnly || entry.installed), [index, query, installedOnly])
  const virtualizer = useVirtualizer({ count: filtered.length, getScrollElement: () => viewport.current,
    estimateSize: () => 116, getItemKey: (index) => filtered[index]!.id, overscan: 3 })

  return <div className="catalog-list">
    <div className="catalog-list-toolbar">
      <Input type="search" ariaLabel={`Search ${category}`} iconName="search" placeholder={`Find a ${category === 'tools' ? 'tool or connection' : 'skill'}…`}
        value={query} onChange={(event) => {
          setQuery(event.target.value)
          viewport.current?.scrollTo({ top: 0 })
        }} />{toolbar}
    </div>
    <div className="catalog-list-filters" role="group" aria-label="Catalog filter">
      <Button size="sm" ariaPressed={!installedOnly} onClick={() => {
        setInstalledOnly(false)
        viewport.current?.scrollTo({ top: 0 })
      }}>All {category}</Button>
      <Button size="sm" ariaPressed={installedOnly} onClick={() => {
        setInstalledOnly(true)
        viewport.current?.scrollTo({ top: 0 })
      }}>Installed</Button>
    </div>
    {loading ? <Loader size="md" label={`Getting your ${category} ready…`} /> : error ? <div role="alert">
      <p>I couldn’t load your {category}. Check the connection and try again.</p><Button onClick={onRetry}>Retry</Button>
    </div> : <>
      <p className="catalog-list-note">Extensions become available only after you add them. Availability and accounts stay private to this profile.</p>
      <ScrollList className="catalog-list-viewport" scrollRef={viewport} aria-label={category === 'tools' ? 'Tools and connections' : 'Skills'}>
        <div role="list" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const entry = filtered[item.index]!

            return <article key={item.key} role="listitem" data-index={item.index} ref={virtualizer.measureElement}
              className="catalog-list-row" aria-label={entry.name}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}>
              <PackageIcon logoUrl={entry.logoUrl} iconName={entry.iconName} className="catalog-logo" />
              <div className="catalog-list-summary">
                <h3><Button className="catalog-list-title" size="sm" onClick={() => onDetails(entry)}>{entry.name}</Button>
                  <span>{entry.kind === 'mcp' ? 'MCP' : entry.kind === 'agent' ? 'Agent skill' : 'Native'}{entry.distribution ? ` · ${entry.distribution === 'built-in' ? 'Built-in' : 'Extension'}` : ''}</span>
                  <MaintenanceBadge entry={entry} onClick={() => onDetails(entry)} />
                </h3><p>{entry.description}</p><small>{state(entry)}</small>
              </div>
              <div className="catalog-list-actions">{actions(entry)}</div>
            </article>
          })}
        </div>
        {!filtered.length && <p className="catalog-list-empty">Nothing found. Try another word.</p>}
      </ScrollList>
    </>}
  </div>
}

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import { Input } from '@/components/input'
import { ScrollList } from '@/components/scroll-list'
import {
  modelProviders,
  type ModelChoice,
  type ModelOption,
  type ModelProvider
} from '@/data/model-catalog'
import { createSearchIndex, searchIndex } from '@/utils/search'

import { ProviderLogo } from './provider-logo'

const ROW_HEIGHT_PX = 48
const ROW_OVERSCAN = 3
const SECTION_HEIGHT_PX = 36
const SEPARATOR_HEIGHT_PX = 17
const MODEL_SEARCH_INDEX = createSearchIndex(
  modelProviders.flatMap((provider) => provider.models.map((model) => ({ provider, model }))),
  ({ provider, model }) => [model.label, model.model, provider.label, provider.id]
)

enum PickerRowKind {
  Section = 'section',
  Separator = 'separator',
  Provider = 'provider',
  Model = 'model'
}

interface PickerOption {
  kind: PickerRowKind.Provider | PickerRowKind.Model
  key: string
  provider: ModelProvider
  model?: ModelOption
}

interface PickerSection {
  kind: PickerRowKind.Section
  key: string
  label: string
}

interface PickerSeparator {
  kind: PickerRowKind.Separator
  key: string
}

type PickerRow = PickerOption | PickerSection | PickerSeparator

interface ModelSelectorMenuProps {
  choice: ModelChoice
  recentModels: readonly ModelChoice[]
  open: boolean
  onChoose: (choice: ModelChoice) => void
  onClose: () => void
}

/**
 * Keeps section headings and separators out of keyboard selection.
 */
function isPickerOption(row: PickerRow | undefined): row is PickerOption {
  return row?.kind === PickerRowKind.Provider || row?.kind === PickerRowKind.Model
}

/**
 * Browses and searches the curated provider/model layers.
 */
export function ModelSelectorMenu({
  choice,
  recentModels,
  open,
  onChoose,
  onClose
}: ModelSelectorMenuProps) {
  const [provider, setProvider] = useState<ModelProvider | null>(null)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const searchRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const search = query.trim()
  const rows = useMemo<PickerRow[]>(() => {
    if (search === '' && provider === null) {
      const providers: PickerOption[] = modelProviders.map((candidate) => ({
        kind: PickerRowKind.Provider,
        key: candidate.id,
        provider: candidate
      }))

      const recent: PickerRow[] = recentModels.length === 0 ? [] : [
        {
          kind: PickerRowKind.Section,
          key: 'recent-models',
          label: 'Recently used models'
        },
        ...recentModels.map((choice): PickerOption => ({
          kind: PickerRowKind.Model,
          key: `recent/${choice.provider.id}/${choice.model.model}`,
          provider: choice.provider,
          model: choice.model
        })),
        {
          kind: PickerRowKind.Separator,
          key: 'recent-providers-divider'
        }
      ]

      return [
        ...recent,
        {
          kind: PickerRowKind.Section,
          key: 'providers',
          label: 'Providers'
        },
        ...providers
      ]
    }

    // Search spans providers even while browsing one provider's model layer.
    const choices = search !== ''
      ? searchIndex(MODEL_SEARCH_INDEX, search).map((result) => result.item)
      : provider === null ? [] : provider.models.map((model) => ({ provider, model }))

    return choices.map(({ provider, model }) => ({
      kind: PickerRowKind.Model,
      key: `${provider.id}/${model.model}`,
      provider,
      model
    }))
  }, [provider, recentModels, search])
  const activeRowIndex = isPickerOption(rows[activeIndex]) ? activeIndex : -1
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = rows[index]

      switch (row?.kind) {
        case PickerRowKind.Section:
          return SECTION_HEIGHT_PX
        case PickerRowKind.Separator:
          return SEPARATOR_HEIGHT_PX
        default:
          return ROW_HEIGHT_PX
      }
    },
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: ROW_OVERSCAN,
    enabled: open
  })

  useLayoutEffect(() => {
    if (open) {
      // Reopening starts at the overview even if the closing portal stays mounted.
      setProvider(null)
      setQuery('')
      setActiveIndex(-1)
      scrollRef.current?.scrollTo({ top: 0 })
    }
  }, [open])

  useEffect(() => {
    setActiveIndex(-1)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [provider, search])

  useEffect(() => {
    if (open) {
      searchRef.current?.focus({ preventScroll: true })
    }
  }, [open, provider])

  function chooseRow(row: PickerOption): void {
    if (row.model === undefined) {
      setProvider(row.provider)
      return
    }

    onChoose({ provider: row.provider, model: row.model })
    onClose()
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void {
    if (event.nativeEvent.isComposing) {
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()

      const row = rows[activeRowIndex < 0 ? rows.findIndex(isPickerOption) : activeRowIndex]

      if (isPickerOption(row)) {
        chooseRow(row)
      }

      return
    }

    if (event.key === 'ArrowLeft' && query === '' && provider !== null) {
      event.preventDefault()
      setProvider(null)
      return
    }

    if (event.key === 'ArrowRight' && query === '' && provider === null) {
      const row = rows[activeRowIndex]

      if (row?.kind === PickerRowKind.Provider) {
        event.preventDefault()
        chooseRow(row)
      }

      return
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return
    }

    event.preventDefault()

    if (rows.length === 0) {
      return
    }

    const direction = event.key === 'ArrowDown' ? 1 : -1
    let next = activeRowIndex < 0
      ? direction > 0 ? 0 : rows.length - 1
      : activeRowIndex + direction

    while (next >= 0 && next < rows.length && !isPickerOption(rows[next])) {
      next += direction
    }

    if (next < 0 || next >= rows.length) {
      return
    }

    setActiveIndex(next)
    virtualizer.scrollToIndex(next, { align: 'auto' })
  }

  return (
    <>
      <Input
        ariaLabel="Search models"
        className="model-selector-search"
        fieldRef={searchRef}
        iconName="search"
        placeholder="Search models..."
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={activeRowIndex < 0 ? undefined : `${listId}-${activeRowIndex}`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onBlur={() => setActiveIndex(-1)}
        onKeyDown={handleSearchKeyDown}
      />
      {(provider !== null || search !== '') && (
        <div className="model-selector-breadcrumb">
          <button
            type="button"
            className="model-selector-back"
            aria-label="Back to providers"
            onClick={() => {
              setProvider(null)
              setQuery('')
              searchRef.current?.focus()
            }}
          >
            <i className="ri-arrow-left-s-line" aria-hidden="true" />
            <span>{search !== '' ? 'Search results' : provider?.label}</span>
          </button>
        </div>
      )}
      <ScrollList
        scrollRef={scrollRef}
        id={listId}
        className="model-selector-list"
        role="listbox"
        aria-label={search !== '' ? 'Matching models' : provider?.label ?? 'Models and providers'}
        onPointerMove={() => setActiveIndex(-1)}
      >
        {rows.length === 0 ? (
          <p className="model-selector-empty">No models found. Try another search.</p>
        ) : (
          <div className="model-selector-list-inner" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index]

              if (row === undefined) {
                return null
              }

              if (!isPickerOption(row)) {
                return (
                  <div
                    key={row.key}
                    role="presentation"
                    className={row.kind === PickerRowKind.Section
                      ? 'model-selector-section-title' : 'model-selector-separator'}
                    style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
                  >
                    {row.kind === PickerRowKind.Section ? row.label : null}
                  </div>
                )
              }

              const selected = row.provider.id === choice.provider.id &&
                (row.kind === PickerRowKind.Provider || row.model?.model === choice.model.model)

              return (
                <div
                  key={row.key}
                  role="presentation"
                  className="model-selector-row-slot list-item-slot"
                  style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
                >
                  <button
                    id={`${listId}-${virtualRow.index}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    tabIndex={-1}
                    className="dropdown-item model-selector-row"
                    data-highlighted={activeRowIndex === virtualRow.index || undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => chooseRow(row)}
                  >
                    <ProviderLogo provider={row.provider.id} />
                    <span className="model-selector-row-copy">
                      <span className="model-selector-row-label">{row.model?.label ?? row.provider.label}</span>
                      {row.model !== undefined && search !== '' && (
                        <span className="model-selector-row-provider">{row.provider.label}</span>
                      )}
                    </span>
                    {row.kind === PickerRowKind.Provider ? (
                      <i className="ri-arrow-right-s-line" aria-hidden="true" />
                    ) : selected ? (
                      <i className="ri-check-fill model-selector-selected" aria-hidden="true" />
                    ) : row.model?.recommended ? (
                      <i className="ri-star-line model-selector-recommended" aria-label="Recommended" />
                    ) : null}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </ScrollList>
    </>
  )
}

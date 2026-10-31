const SEARCH_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const DIACRITICS = /\p{M}/gu
const SEPARATORS = /[^\p{L}\p{N}]/gu
const WHITESPACE = /\s+/u
const NUMERIC_TERM = /^\p{N}+$/u

enum SearchRank {
  Exact,
  Prefix,
  Substring,
  Terms
}

interface SearchRange {
  start: number
  end: number
}

interface SearchField {
  text: string
  compact: string
  positions: SearchRange[]
}

interface SearchEntry<T> {
  item: T
  fields: SearchField[]
}

export interface SearchResult<T> extends SearchEntry<T> {
  rank: SearchRank
  terms: readonly string[]
}

export interface SearchSegment {
  text: string
  highlighted: boolean
}

/**
 * Folds presentation differences without guessing missing or mistyped characters.
 */
function compactSearchText(text: string): string {
  return text.normalize('NFKD').toUpperCase()
    .replace(DIACRITICS, '').replace(SEPARATORS, '')
}

/**
 * Prepares searchable fields once while preserving offsets into their original text.
 * Rebuild the index when the collection or its searchable fields change.
 */
export function createSearchIndex<T>(
  items: readonly T[],
  getFields: (item: T) => readonly string[]
): SearchEntry<T>[] {
  return items.map((item) => ({
    item,
    fields: getFields(item).map((text) => {
      let compact = ''
      const positions: SearchRange[] = []

      // Grapheme offsets keep highlights intact through accents and Unicode folding.
      for (const { segment, index } of SEARCH_SEGMENTER.segment(text)) {
        const normalized = compactSearchText(segment)

        compact += normalized

        for (let offset = 0; offset < normalized.length; offset += 1) {
          positions.push({ start: index, end: index + segment.length })
        }
      }

      return { text, compact, positions }
    })
  }))
}

/**
 * Ranks compact phrases before terms spanning fields, preserving input order on ties.
 */
export function searchIndex<T>(
  index: readonly SearchEntry<T>[],
  query: string
): SearchResult<T>[] {
  const compact = compactSearchText(query)
  const terms: string[] = []

  for (const token of query.trim().split(WHITESPACE)) {
    const term = compactSearchText(token)

    if (term === '') {
      continue
    }

    // Numeric qualifiers belong to their preceding term, not unrelated digits elsewhere.
    if (terms.length > 0 && NUMERIC_TERM.test(term)) {
      terms[terms.length - 1] += term
    } else {
      terms.push(term)
    }
  }

  if (compact === '') {
    return index.map((entry) => ({ ...entry, rank: SearchRank.Exact, terms: [] }))
  }

  const results: SearchResult<T>[] = []

  for (const entry of index) {
    let rank = SearchRank.Terms

    for (const field of entry.fields) {
      const matchIndex = field.compact.indexOf(compact)

      if (matchIndex === -1) {
        continue
      }

      const fieldRank = field.compact === compact
        ? SearchRank.Exact
        : matchIndex === 0 ? SearchRank.Prefix : SearchRank.Substring

      rank = Math.min(rank, fieldRank)
    }

    if (
      rank === SearchRank.Terms &&
      !terms.every((term) => entry.fields.some((field) => field.compact.includes(term)))
    ) {
      continue
    }

    results.push({
      ...entry,
      rank,
      terms: rank === SearchRank.Terms ? terms : [compact]
    })
  }

  return results.sort((first, second) => first.rank - second.rank)
}

/**
 * Highlights a result field using the same matches that admitted it to the results.
 */
export function getSearchSegments<T>(
  result: SearchResult<T>,
  fieldIndex = 0
): SearchSegment[] {
  const field = result.fields[fieldIndex]

  if (field === undefined) {
    return []
  }

  const ranges: SearchRange[] = []

  for (const term of result.terms) {
    let matchIndex = field.compact.indexOf(term)

    while (matchIndex !== -1) {
      const first = field.positions[matchIndex]
      const last = field.positions[matchIndex + term.length - 1]

      if (first !== undefined && last !== undefined) {
        ranges.push({ start: first.start, end: last.end })
      }

      matchIndex = field.compact.indexOf(term, matchIndex + term.length)
    }
  }

  const merged: SearchRange[] = []

  for (const range of ranges.sort((first, second) => first.start - second.start)) {
    const previous = merged.at(-1)

    if (previous !== undefined && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }

  const segments: SearchSegment[] = []
  let cursor = 0

  for (const range of merged) {
    if (range.start > cursor) {
      segments.push({ text: field.text.slice(cursor, range.start), highlighted: false })
    }

    segments.push({ text: field.text.slice(range.start, range.end), highlighted: true })
    cursor = range.end
  }

  if (cursor < field.text.length) {
    segments.push({ text: field.text.slice(cursor), highlighted: false })
  }

  return segments
}

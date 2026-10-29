import { describe, expect, it } from 'vitest'

import {
  createSearchIndex,
  getSearchSegments,
  searchIndex
} from '../../../web-app/src/utils/search.ts'

const MODEL_CHOICES = [
  { name: 'GPT-6.1 Sol', id: 'gpt-6.1-sol', provider: 'OpenAI' },
  { name: 'GPT-6 Astra', id: 'gpt-6-astra', provider: 'OpenAI' },
  { name: 'Other model', id: 'other-model', provider: 'Other provider' }
]
const MODEL_INDEX = createSearchIndex(
  MODEL_CHOICES,
  (model) => [model.name, model.id, model.provider]
)

describe('web app shared search', () => {
  it.each(['gpt6', 'gpt 6', 'GPT-6', 'gpt_6', 'gpt\t6'])(
    'finds model families despite case and separator differences in "%s"',
    (query) => {
      expect(searchIndex(MODEL_INDEX, query).map((result) => result.item))
        .toEqual(MODEL_CHOICES.slice(0, 2))
    }
  )

  it.each(['gpt61', 'gpt 61', 'gpt 6.1', 'gpt-6-1'])(
    'matches a compact version in "%s" without admitting other versions',
    (query) => {
      expect(searchIndex(MODEL_INDEX, query).map((result) => result.item))
        .toEqual([MODEL_CHOICES[0]])
    }
  )

  it('requires every term, allowing terms to span fields in either order', () => {
    for (const query of ['openai gpt61', 'gpt61 openai', 'sol open ai']) {
      expect(searchIndex(MODEL_INDEX, query).map((result) => result.item))
        .toEqual([MODEL_CHOICES[0]])
    }

    expect(searchIndex(MODEL_INDEX, 'gpt61 other')).toEqual([])
    expect(searchIndex(MODEL_INDEX, 'gpt62')).toEqual([])
  })

  it('keeps numeric qualifiers with their name instead of matching digits in another version', () => {
    const index = createSearchIndex(
      ['gpt-6.1-sol', 'gpt-5.6-sol', 'gpt-5.2-2026-06'],
      (model) => [model]
    )

    for (const query of ['gpt6', 'gpt 6', 'gpt 6.1', 'gpt 6 1']) {
      expect(searchIndex(index, query).map((result) => result.item))
        .toEqual(['gpt-6.1-sol'])
    }
  })

  it('ranks exact matches, prefixes, substrings, and separated terms in that order', () => {
    const index = createSearchIndex([
      'A GPT guide to Sol',
      'Notes on GPT-Sol',
      'GPT-Sol preview',
      'GPT Sol'
    ], (title) => [title])

    expect(searchIndex(index, 'gpt sol').map((result) => result.item)).toEqual([
      'GPT Sol',
      'GPT-Sol preview',
      'Notes on GPT-Sol',
      'A GPT guide to Sol'
    ])
  })

  it('preserves newest-first input order within a relevance group and for empty queries', () => {
    const titles = ['GPT-6.1 newest', 'GPT-6.1 older', 'Unrelated']
    const index = createSearchIndex(titles, (title) => [title])

    expect(searchIndex(index, 'gpt61').map((result) => result.item))
      .toEqual(titles.slice(0, 2))

    for (const query of ['', '   ', '-_.']) {
      const results = searchIndex(index, query)

      expect(results.map((result) => result.item)).toEqual(titles)
      expect(getSearchSegments(results[0]!))
        .toEqual([{ text: titles[0], highlighted: false }])
    }
  })

  it('highlights original graphemes after accent and compatibility folding', () => {
    const title = '😀 Cafe\u0301 ＧＰＴ-６.１ notes'
    const index = createSearchIndex([title], (value) => [value])
    const result = searchIndex(index, 'gpt61 cafe')[0]!
    const segments = getSearchSegments(result)

    expect(segments).toEqual([
      { text: '😀 ', highlighted: false },
      { text: 'Cafe\u0301', highlighted: true },
      { text: ' ', highlighted: false },
      { text: 'ＧＰＴ-６.１', highlighted: true },
      { text: ' notes', highlighted: false }
    ])
    expect(segments.map((segment) => segment.text).join('')).toBe(title)
  })

  it('highlights every phrase occurrence, including its original punctuation', () => {
    const index = createSearchIndex(['GPT-6.1 vs gpt 61'], (title) => [title])
    const result = searchIndex(index, 'gpt61')[0]!

    expect(getSearchSegments(result)).toEqual([
      { text: 'GPT-6.1', highlighted: true },
      { text: ' vs ', highlighted: false },
      { text: 'gpt 61', highlighted: true }
    ])
  })

  it('merges overlapping term highlights without duplicating source text', () => {
    const index = createSearchIndex(['alpha beta'], (title) => [title])
    const result = searchIndex(index, 'alp alpha')[0]!

    expect(getSearchSegments(result)).toEqual([
      { text: 'alpha', highlighted: true },
      { text: ' beta', highlighted: false }
    ])
  })

  it('retains non-Latin text and handles empty collections', () => {
    const index = createSearchIndex(['模型选择'], (title) => [title])

    expect(searchIndex(index, '模型')[0]?.item).toBe('模型选择')
    expect(searchIndex([], 'gpt61')).toEqual([])
  })

  it.each([
    ['ΟΣ', 'ος'],
    ['Straße', 'STRASSE']
  ])('keeps Unicode case folding consistent for "%s"', (title, query) => {
    const index = createSearchIndex([title], (value) => [value])
    const result = searchIndex(index, query)[0]!

    expect(result.item).toBe(title)
    expect(getSearchSegments(result)).toEqual([{ text: title, highlighted: true }])
  })
})

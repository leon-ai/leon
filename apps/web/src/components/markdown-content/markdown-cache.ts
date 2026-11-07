import type { BlockProps } from 'streamdown'

export enum MarkdownCacheKind {
  Blocks = 'blocks',
  Text = 'text',
  Math = 'math'
}

const MAXIMUM_CACHE_BYTES = 2 * 1_024 * 1_024
const MAXIMUM_CACHE_ENTRIES = 128
const MAXIMUM_ENTRY_BYTES = MAXIMUM_CACHE_BYTES / 4
const CHARACTER_BYTES = 2
const ENTRY_OVERHEAD_BYTES = 128
const entries = new Map<string, { value: string, bytes: number }>()
let retainedBytes = 0

interface MarkdownCacheOptions {
  profile: string
  completed: boolean
  math: boolean
}

type MarkdownParserPlugin = Extract<
  NonNullable<BlockProps['remarkPlugins']>[number],
  (...parameters: never[]) => unknown
>

/**
 * Reuses completed parsing work across remounts without retaining React elements
 * or mutable trees. Serialized payloads and keys share one byte/entry-bounded LRU.
 */
export function readCompletedMarkdown<T>(
  profile: string,
  kind: MarkdownCacheKind,
  source: string,
  completed: boolean,
  parse: () => T
): T {
  // Live prefixes never populate the cache; large messages cannot evict all of
  // the smaller, frequently revisited blocks just to retain a single entry.
  if (!completed || !profile || source.length * CHARACTER_BYTES > MAXIMUM_ENTRY_BYTES) {
    return parse()
  }
  const key = JSON.stringify([profile, kind, source])
  const cached = entries.get(key)
  if (cached) {
    entries.delete(key)
    entries.set(key, cached)

    return JSON.parse(cached.value) as T
  }

  const result = parse()
  const value = JSON.stringify(result)
  if (value === undefined) {
    return result
  }
  const bytes = (key.length + value.length) * CHARACTER_BYTES + ENTRY_OVERHEAD_BYTES
  if (bytes > MAXIMUM_ENTRY_BYTES) {
    return result
  }
  while (entries.size >= MAXIMUM_CACHE_ENTRIES || retainedBytes + bytes > MAXIMUM_CACHE_BYTES) {
    const oldest = entries.keys().next().value!
    retainedBytes -= entries.get(oldest)!.bytes
    entries.delete(oldest)
  }
  entries.set(key, { value, bytes })
  retainedBytes += bytes

  return result
}

/**
 * Wraps Unified's public parser hook only. Sanitization, per-message IDs, maths
 * rendering and character motion still run normally on fresh tree instances.
 */
export const cacheMarkdownParse: MarkdownParserPlugin = function cacheMarkdownParse(
  options: MarkdownCacheOptions
): void {
  const parse = this.parser
  if (!parse || !options.completed) {
    return
  }
  this.parser = (source, file): ReturnType<typeof parse> => readCompletedMarkdown(
    options.profile,
    options.math ? MarkdownCacheKind.Math : MarkdownCacheKind.Text,
    source,
    true,
    () => parse.call(this, source, file)
  )
}

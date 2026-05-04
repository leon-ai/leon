import fs from 'node:fs'
import path from 'node:path'

import {
  CODEBASE_CONTEXT_PATH,
  PROFILE_CONTEXT_PATH
} from '@bridge/constants'
import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const DEFAULT_LIST_LIMIT = 24
const DEFAULT_TOP_K = 8
const DEFAULT_SNIPPET_CHARS = Number.MAX_SAFE_INTEGER
const CODEBASE_CONTEXT_FILES = new Set([
  'ARCHITECTURE.md',
  'LEON.md'
])

interface ContextListEntry {
  filename: string
  summary: string
  sizeChars: number
  updatedAt: string
}

interface SearchHit {
  filename: string
  score: number
  snippet: string
  matchIndex: number
}

export default class ContextTool extends Tool {
  private static readonly TOOLKIT = 'structured_knowledge'
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    this.config = ToolkitConfig.load(ContextTool.TOOLKIT, this.toolName)
    this.settings = ToolkitConfig.loadToolSettings(
      ContextTool.TOOLKIT,
      this.toolName,
      {}
    )
    this.requiredSettings = []
    this.checkRequiredSettings(this.toolName)
  }

  get toolName(): string {
    return 'context'
  }

  get toolkit(): string {
    return ContextTool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  public async listContextFiles(
    query = '',
    limit = DEFAULT_LIST_LIMIT
  ): Promise<{
    success: boolean
    data: {
      total: number
      files: ContextListEntry[]
    }
  }> {
    await this.ensureContextDir()
    const files = await this.readContextEntries()
    const normalizedQuery = String(query || '').trim().toLowerCase()
    const maxItems = this.clampNumber(limit, 1, 100, DEFAULT_LIST_LIMIT)

    const filtered = normalizedQuery
      ? files.filter((entry) => {
          const target = `${entry.filename}\n${entry.summary}`.toLowerCase()
          return target.includes(normalizedQuery)
        })
      : files

    return {
      success: true,
      data: {
        total: filtered.length,
        files: filtered.slice(0, maxItems)
      }
    }
  }

  public async readContextFile(
    filename: string,
    options: { offsetChars?: number, maxChars?: number } = {}
  ): Promise<{
    success: boolean
    data?: {
      filename: string
      offsetChars: number
      maxChars: number
      returnedChars: number
      totalChars: number
      hasMore: boolean
      nextOffsetChars: number | null
      content: string
      fullyShared: boolean
    }
    error?: string
  }> {
    const safeFilename = this.resolveFilename(filename)
    if (!safeFilename) {
      return {
        success: false,
        error: 'Invalid context filename.'
      }
    }

    const filePath = this.resolveContextFilePath(safeFilename)
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        error: `Context file not found: ${safeFilename}`
      }
    }

    const content = await fs.promises.readFile(filePath, 'utf8')
    const totalChars = content.length
    const offsetChars = this.clampNumber(
      options.offsetChars,
      0,
      totalChars,
      0
    )
    const remainingChars = Math.max(0, totalChars - offsetChars)
    const requestedMaxChars = Number(options.maxChars)
    const maxChars =
      totalChars > 0 &&
      Number.isFinite(requestedMaxChars) &&
      requestedMaxChars > 0
        ? this.clampNumber(requestedMaxChars, 1, totalChars, totalChars)
        : remainingChars

    const chunk = content.slice(offsetChars, offsetChars + maxChars)
    const nextOffset = offsetChars + chunk.length
    const hasMore = nextOffset < totalChars

    return {
      success: true,
      data: {
        filename: safeFilename,
        offsetChars,
        maxChars,
        returnedChars: chunk.length,
        totalChars,
        hasMore,
        nextOffsetChars: hasMore ? nextOffset : null,
        content: chunk,
        fullyShared: !hasMore && offsetChars === 0
      }
    }
  }

  public async searchContext(
    query: string,
    options: {
      filenames?: string[]
      topK?: number
      snippetChars?: number
    } = {}
  ): Promise<{
    success: boolean
    data: {
      query: string
      topK: number
      searchedFiles: string[]
      hits: SearchHit[]
    }
  }> {
    await this.ensureContextDir()
    const normalizedQuery = String(query || '').trim()
    if (!normalizedQuery) {
      return {
        success: true,
        data: {
          query: '',
          topK: 0,
          searchedFiles: [],
          hits: []
        }
      }
    }

    const entries = await this.readContextEntries()
    const allowed = new Set(
      (options.filenames || [])
        .map((filename) => this.resolveFilename(filename))
        .filter((filename): filename is string => Boolean(filename))
    )
    const topK = this.clampNumber(options.topK, 1, 24, DEFAULT_TOP_K)
    const requestedSnippetChars = Number(options.snippetChars)
    const snippetChars =
      Number.isFinite(requestedSnippetChars) && requestedSnippetChars > 0
        ? Math.floor(requestedSnippetChars)
        : DEFAULT_SNIPPET_CHARS

    const searchableEntries =
      allowed.size > 0
        ? entries.filter((entry) => allowed.has(entry.filename))
        : entries

    const queryTokens = this.tokenize(normalizedQuery)
    const hits: SearchHit[] = []

    for (const entry of searchableEntries) {
      const lower = entry.content.toLowerCase()
      const tokenScores = queryTokens.map((token) => {
        if (!token) {
          return 0
        }
        return lower.includes(token) ? 1 : 0
      })
      const tokenMatchCount = tokenScores.reduce<number>(
        (total, score) => total + score,
        0
      )
      if (tokenMatchCount === 0) {
        continue
      }

      const fullQueryIndex = lower.indexOf(normalizedQuery.toLowerCase())
      const fallbackIndex =
        fullQueryIndex >= 0
          ? fullQueryIndex
          : queryTokens.reduce((best, token) => {
              if (!token) {
                return best
              }
              const idx = lower.indexOf(token)
              if (idx === -1) {
                return best
              }
              if (best === -1) {
                return idx
              }
              return Math.min(best, idx)
            }, -1)
      const matchIndex = Math.max(0, fallbackIndex)

      const score =
        tokenMatchCount / Math.max(1, queryTokens.length) +
        (fullQueryIndex >= 0 ? 0.5 : 0)

      hits.push({
        filename: entry.filename,
        score,
        snippet: this.buildSnippet(entry.content, matchIndex, snippetChars),
        matchIndex
      })
    }

    hits.sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score
      }
      return a.matchIndex - b.matchIndex
    })

    return {
      success: true,
      data: {
        query: normalizedQuery,
        topK,
        searchedFiles: searchableEntries.map((entry) => entry.filename),
        hits: hits.slice(0, topK)
      }
    }
  }

  private async ensureContextDir(): Promise<void> {
    await fs.promises.mkdir(PROFILE_CONTEXT_PATH, { recursive: true })
  }

  private resolveFilename(filename: string): string | null {
    const normalized = path.basename(String(filename || '').trim())
    if (!normalized || !normalized.toUpperCase().endsWith('.MD')) {
      return null
    }

    if (!this.isSafeContextFilename(normalized)) {
      return null
    }

    return normalized
  }

  private resolveContextFilePath(filename: string): string {
    return path.join(this.getContextDirectory(filename), filename)
  }

  private getContextDirectory(filename: string): string {
    if (CODEBASE_CONTEXT_FILES.has(filename)) {
      return CODEBASE_CONTEXT_PATH
    }

    return PROFILE_CONTEXT_PATH
  }

  private isSafeContextFilename(filename: string): boolean {
    return path.basename(filename) === filename
  }

  private async readContextEntries(): Promise<Array<{
    filename: string
    summary: string
    sizeChars: number
    updatedAt: string
    content: string
  }>> {
    const markdownFiles = await this.listContextFilenames()

    const output: Array<{
      filename: string
      summary: string
      sizeChars: number
      updatedAt: string
      content: string
    }> = []

    for (const filename of markdownFiles) {
      const filePath = this.resolveContextFilePath(filename)
      const [stat, content] = await Promise.all([
        fs.promises.stat(filePath),
        fs.promises.readFile(filePath, 'utf8')
      ])
      const summary = this.extractSummary(content)
      output.push({
        filename,
        summary,
        sizeChars: content.length,
        updatedAt: stat.mtime.toISOString(),
        content
      })
    }

    return output
  }

  private async listContextFilenames(): Promise<string[]> {
    const filenames = new Set<string>()

    await this.addContextFilenamesFromDirectory(
      CODEBASE_CONTEXT_PATH,
      filenames,
      (filename) => CODEBASE_CONTEXT_FILES.has(filename)
    )
    await this.addContextFilenamesFromDirectory(
      PROFILE_CONTEXT_PATH,
      filenames,
      (filename) => !CODEBASE_CONTEXT_FILES.has(filename)
    )

    return [...filenames].sort((a, b) => a.localeCompare(b))
  }

  private async addContextFilenamesFromDirectory(
    directoryPath: string,
    filenames: Set<string>,
    shouldInclude: (filename: string) => boolean
  ): Promise<void> {
    let entries: fs.Dirent[] = []
    try {
      entries = await fs.promises.readdir(directoryPath, {
        withFileTypes: true
      })
    } catch {
      return
    }

    for (const entry of entries) {
      if (
        !entry.isFile() ||
        !entry.name.toLowerCase().endsWith('.md') ||
        !this.isSafeContextFilename(entry.name) ||
        !shouldInclude(entry.name)
      ) {
        continue
      }

      filenames.add(entry.name)
    }
  }

  private extractSummary(content: string): string {
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    const preferred = lines.find((line) => line.startsWith('>'))
    const first = preferred || lines[0] || ''
    const normalized = first.replace(/^>\s*/, '').replace(/\s+/g, ' ').trim()
    if (!normalized) {
      return ''
    }

    return normalized.length > 180
      ? `${normalized.slice(0, 177).trimEnd()}...`
      : normalized
  }

  private tokenize(value: string): string[] {
    return (value.toLowerCase().match(/[a-z0-9_]+/g) || [])
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  }

  private clampNumber(
    value: unknown,
    min: number,
    max: number,
    fallback: number
  ): number {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      return fallback
    }
    return Math.max(min, Math.min(max, Math.floor(parsed)))
  }

  private buildSnippet(content: string, center: number, maxChars: number): string {
    if (content.length <= maxChars) {
      return content
    }

    const half = Math.floor(maxChars / 2)
    const start = Math.max(0, center - half)
    const end = Math.min(content.length, start + maxChars)
    const raw = content.slice(start, end)
    const prefix = start > 0 ? '...' : ''
    const suffix = end < content.length ? '...' : ''

    return `${prefix}${raw}${suffix}`
  }
}

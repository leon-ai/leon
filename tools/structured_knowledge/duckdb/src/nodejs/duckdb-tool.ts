import fs from 'node:fs/promises'
import path from 'node:path'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'
import { FileHelper } from '@/helpers/file-helper'
import { RuntimeHelper } from '@/helpers/runtime-helper'

const MAX_SOURCES = 20
const SAMPLE_ROWS = 5
const QUERY_TIMEOUT_MS = 120_000
const DEFAULT_SETTINGS = {
  maxRows: 1_000,
  memoryMB: 512
}
const READERS: Record<string, string> = {
  '.csv': 'read_csv_auto',
  '.tsv': 'read_csv_auto',
  '.json': 'read_json_auto',
  '.jsonl': 'read_json_auto',
  '.ndjson': 'read_json_auto',
  '.parquet': 'read_parquet'
}

interface Source {
  name: string
  path: string
}

/**
 * Analyze declared local data in an ephemeral, resource-bounded DuckDB database.
 */
export default class DuckDBTool extends Tool {
  private readonly config = ToolkitConfig.load(this.toolkit, this.toolName)

  constructor() {
    super()
    this.settings = ToolkitConfig.loadToolSettings(this.toolkit, this.toolName, DEFAULT_SETTINGS)
  }

  get toolName(): string {
    return 'duckdb'
  }

  get toolkit(): string {
    return 'structured_knowledge'
  }

  get description(): string {
    return this.config.description
  }

  /**
   * Read inferred columns and a small sample before composing analytical SQL.
   */
  async inspect(paths: string[]): Promise<Record<string, unknown>> {
    if (!Array.isArray(paths)) {
      throw new Error('paths must be an array')
    }

    const sources = await this.resolveSources(paths.map((sourcePath, index) => ({
      name: `source_${index + 1}`,
      path: sourcePath
    })))
    const binary = await this.getBinaryPath('duckdb')
    const tables = []

    // Bind only the current source, and collect schema plus sample in one
    // process. Sequential inspection preserves the configured memory budget.
    for (const source of sources) {
      const table = this.identifier(source.name)
      const inspection = await this.execute(binary, `${this.setup([source])}
        SELECT
          (SELECT list(columns) FROM (DESCRIBE ${table}) AS columns) AS columns,
          (SELECT coalesce(list(sample), []) FROM
            (SELECT * FROM ${table} LIMIT ${SAMPLE_ROWS}) AS sample) AS sample;
      `)
      tables.push({ ...source, ...inspection[0] })
    }

    return { sources: tables }
  }

  /**
   * Execute one SELECT, including CTEs and joins, against named local sources.
   */
  async query(sources: Source[], sql: string): Promise<Record<string, unknown>> {
    const resolved = await this.resolveSources(sources)
    if (typeof sql !== 'string' || !sql.trim() || sql.includes('\0')) {
      throw new Error('sql must be a non-empty SELECT without NUL bytes')
    }

    const binary = await this.getBinaryPath('duckdb')
    // Ask DuckDB's own parser, rather than matching SQL keywords. Its JSON
    // serializer only supports SELECT statements; reject multiple statements.
    const validation = await this.execute(binary, `
      WITH input AS (SELECT json_serialize_sql(${this.literal(sql)}) AS ast)
      SELECT ast, CASE WHEN NOT CAST(ast->>'error' AS BOOLEAN)
        THEN json_deserialize_sql(ast) END AS sql FROM input;
    `)
    const parsed = validation[0] as {
      ast?: { error?: boolean, statements?: unknown[] }
      sql?: string
    } | undefined
    if (parsed?.ast?.error || parsed?.ast?.statements?.length !== 1 || !parsed.sql) {
      throw new Error('Only one read-only SELECT statement is allowed')
    }

    const maxRows = this.setting('maxRows', 10_000)
    // Canonical SQL cannot close the wrapper to inject a second statement.
    const rendered = parsed.sql.trim()
    const canonical = rendered.endsWith(';') ? rendered.slice(0, -1) : rendered
    const rows = await this.execute(binary, `${this.setup(resolved)}
      SELECT * FROM (${canonical}) AS leon_result LIMIT ${maxRows + 1};
    `)

    return {
      rows: rows.slice(0, maxRows),
      returnedRows: Math.min(rows.length, maxRows),
      truncated: rows.length > maxRows,
      sources: resolved
    }
  }

  private async resolveSources(sources: Source[]): Promise<Source[]> {
    if (!Array.isArray(sources) || sources.length < 1 || sources.length > MAX_SOURCES) {
      throw new Error(`Provide 1 to ${MAX_SOURCES} local sources`)
    }

    const names = new Set<string>()
    return Promise.all(sources.map(async (source) => {
      if (!source || typeof source.name !== 'string' || !source.name.trim() ||
          source.name.includes('\0') || names.has(source.name.toLowerCase())) {
        throw new Error('Source names must be non-empty and unique, ignoring case')
      }
      names.add(source.name.toLowerCase())
      if (typeof source.path !== 'string' || !source.path || source.path.includes('\0')) {
        throw new Error('Each source requires a local file path')
      }

      const resolved = await fs.realpath(path.resolve(FileHelper.expandHomeAlias(source.path)))
      if (!(await fs.stat(resolved)).isFile() || !READERS[path.extname(resolved).toLowerCase()]) {
        throw new Error('Sources must be local CSV, TSV, JSON, JSONL or Parquet files')
      }

      return { name: source.name, path: resolved }
    }))
  }

  private setup(sources: Source[]): string {
    const allowed = sources.map((source) => this.literal(source.path)).join(', ')
    const views = sources.map((source) => `CREATE VIEW ${this.identifier(source.name)} AS
      SELECT * FROM ${READERS[path.extname(source.path).toLowerCase()]}(${this.literal(source.path)});`)

    // Explicit file access remains available; extension loading, network access,
    // undeclared files and spilling to disk are disabled before binding sources.
    return `SET allowed_paths=[${allowed}];
      SET autoinstall_known_extensions=false;
      SET autoload_known_extensions=false;
      SET temp_directory='';
      SET memory_limit='${this.setting('memoryMB', 4_096)}MB';
      SET enable_external_access=false;
      SET lock_configuration=true;
      ${views.join('\n')}`
  }

  private setting(name: keyof typeof DEFAULT_SETTINGS, maximum: number): number {
    const value = this.settings[name] ?? DEFAULT_SETTINGS[name]
    if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > maximum) {
      throw new Error(`${name} must be an integer from 1 to ${maximum}`)
    }

    return Number(value)
  }

  private async execute(binary: string, sql: string): Promise<Record<string, unknown>[]> {
    const output = await RuntimeHelper.runBinary(binary, ['-no-init', '-batch', '-bail', '-json', ':memory:', '-c', sql], {
      timeoutMs: QUERY_TIMEOUT_MS,
      ...(this.executionContext?.signal ? { signal: this.executionContext.signal } : {})
    })

    return output ? JSON.parse(output) as Record<string, unknown>[] : []
  }

  private literal(value: string): string {
    return `'${value.replaceAll('\'', '\'\'')}'`
  }

  private identifier(value: string): string {
    return `"${value.replaceAll('"', '""')}"`
  }
}

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ToolkitConfig } from '@sdk/toolkit-config'
import DuckDBTool from '@@/tools/structured_knowledge/duckdb/src/nodejs'
import { generateDuckDBFixtures } from '../../fixtures/duckdb/generate'

const FIXTURE_TIMEOUT_MS = 120_000

let fixture: Awaited<ReturnType<typeof generateDuckDBFixtures>>
let tool: DuckDBTool

beforeAll(async () => {
  // Regenerate from source rather than trusting cached data or golden totals.
  // Leave these files available for interactive Leon queries afterward.
  fixture = await generateDuckDBFixtures()
}, FIXTURE_TIMEOUT_MS)

beforeEach(() => {
  // Use the shipped defaults without reading or modifying the owner's settings.
  vi.spyOn(ToolkitConfig, 'loadToolSettings').mockImplementation(
    (_toolkit, _tool, defaults) => ({ ...defaults })
  )
  tool = new DuckDBTool()
})

describe('DuckDB tool with local sales data', () => {
  it('infers CSV and JSON schemas and returns bounded samples', async () => {
    const inspection = await tool.inspect(fixture.sources.map((source) => source.path))
    const sources = inspection['sources'] as {
      name: string
      columns: { column_name: string, column_type: string }[]
      sample: Record<string, unknown>[]
    }[]

    expect(sources.map((source) => source.name)).toEqual(['source_1', 'source_2'])
    expect(sources.map((source) => source.sample.length)).toEqual([5, 5])
    expect(sources[0]!.columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ column_name: 'product_id', column_type: 'BIGINT' }),
      expect.objectContaining({ column_name: 'ordered_at', column_type: 'DATE' })
    ]))
    expect(sources[1]!.columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ column_name: 'category', column_type: 'VARCHAR' }),
      expect.objectContaining({ column_name: 'active', column_type: 'BOOLEAN' })
    ]))
    expect(sources[1]!.sample[0]).toMatchObject({
      product_id: 1,
      name: 'Product 1, "édition spéciale"'
    })
  })

  it('joins CSV orders to JSON products and matches independent totals', async () => {
    const result = await tool.query(fixture.sources, `
      WITH completed_orders AS (
        SELECT * FROM orders WHERE status = 'completed'
      )
      SELECT p.category, o.region,
        COUNT(*) AS order_count,
        CAST(SUM(o.quantity) AS BIGINT) AS units,
        CAST(SUM(o.quantity * o.unit_price_cents) AS BIGINT) AS revenue_cents
      FROM completed_orders o
      JOIN products p ON p.product_id = o.product_id
      GROUP BY p.category, o.region
      ORDER BY p.category, o.region
    `)

    expect(result['rows']).toEqual(fixture.expectedRows)
    expect(result['returnedRows']).toBe(fixture.expectedRows.length)
    expect(result['truncated']).toBe(false)
    expect(result['sources']).toEqual(fixture.sources)
  })

  it('limits returned rows without limiting the source scan', async () => {
    const result = await tool.query([fixture.sources[1]!], `
      SELECT product_id, COUNT(*) OVER () AS total_products
      FROM products ORDER BY product_id
    `)
    const rows = result['rows'] as Record<string, unknown>[]

    expect(result['returnedRows']).toBe(1_000)
    expect(result['truncated']).toBe(true)
    expect(rows).toHaveLength(1_000)
    expect(rows[0]).toEqual({ product_id: 1, total_products: fixture.productCount })
    expect(rows.at(-1)).toEqual({ product_id: 1_000, total_products: fixture.productCount })
  })

  it.each([
    'DELETE FROM orders',
    'SELECT * FROM orders; SELECT * FROM products'
  ])('rejects non-read-only or multiple statements: %s', async (sql) => {
    await expect(tool.query(fixture.sources, sql))
      .rejects.toThrow('Only one read-only SELECT statement is allowed')
  })
})

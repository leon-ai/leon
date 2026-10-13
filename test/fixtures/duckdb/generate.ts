import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIRECTORY = fileURLToPath(new URL('.', import.meta.url))
const ORDER_COUNT = 100_000
const PRODUCT_COUNT = 10_000
const CHUNK_ROWS = 5_000
const CUSTOMER_COUNT = 25_000
const START_DATE_UTC = Date.UTC(2025, 0, 1)
const DAYS = 365
const DAY_MS = 24 * 60 * 60 * 1_000
const PRODUCT_HASH_MULTIPLIER = 2_654_435_761
const CATEGORIES = [
  'Electronics', 'Home', 'Books', 'Clothing',
  'Sports', 'Toys', 'Beauty', 'Grocery'
]
const REGIONS = ['APAC', 'EU', 'LATAM', 'NA']
const STATUSES = ['completed', 'completed', 'completed', 'refunded', 'cancelled']
const ORDER_COLUMNS = [
  'order_id', 'customer_id', 'product_id', 'ordered_at',
  'quantity', 'unit_price_cents', 'region', 'status'
]

interface Aggregate {
  category: string
  region: string
  order_count: number
  units: number
  revenue_cents: number
}

interface Fixture {
  orderCount: number
  productCount: number
  sources: { name: string, path: string }[]
  expectedRows: Aggregate[]
}

/**
 * Write reproducible synthetic sales data and an independent JavaScript oracle.
 * Keep CSV generation bounded in memory so it works on modest machines.
 */
export async function generateDuckDBFixtures(): Promise<Fixture> {
  const products = Array.from({ length: PRODUCT_COUNT }, (_, index) => ({
    product_id: index + 1,
    name: `Product ${index + 1}, "édition spéciale"`,
    category: CATEGORIES[index % CATEGORIES.length]!,
    brand: `Brand ${index % 100 + 1}`,
    unit_price_cents: 500 + index % 1_000 * 37,
    active: index % 10 !== 0
  }))
  const dates = Array.from({ length: DAYS }, (_, index) =>
    new Date(START_DATE_UTC + index * DAY_MS).toISOString().slice(0, 10)
  )
  const totals = new Map<string, Aggregate>()
  const sources = [
    { name: 'orders', path: path.join(DIRECTORY, 'orders.csv') },
    { name: 'products', path: path.join(DIRECTORY, 'products.json') }
  ]

  function* productRows(): Generator<string> {
    yield '[\n'

    for (let start = 0; start < PRODUCT_COUNT; start += CHUNK_ROWS) {
      const rows = products.slice(start, start + CHUNK_ROWS)
        .map((product) => JSON.stringify(product))

      yield `${start === 0 ? '' : ',\n'}${rows.join(',\n')}`
    }

    yield '\n]\n'
  }

  function* orderRows(): Generator<string> {
    yield `${ORDER_COLUMNS.join(',')}\n`

    for (let start = 0; start < ORDER_COUNT; start += CHUNK_ROWS) {
      const rows: string[] = []
      const end = Math.min(start + CHUNK_ROWS, ORDER_COUNT)

      for (let index = start; index < end; index += 1) {
        // Mix product IDs so joins do not benefit from sorted keys or a tiny
        // repeated catalog. All order references still resolve to real products.
        const productIndex = (Math.imul(index, PRODUCT_HASH_MULTIPLIER) >>> 0) % PRODUCT_COUNT
        const product = products[productIndex]!
        const quantity = index % 5 + 1
        const region = REGIONS[Math.floor(index / 31) % REGIONS.length]!
        const status = STATUSES[Math.floor(index / 13) % STATUSES.length]!

        rows.push([
          index + 1,
          index % CUSTOMER_COUNT + 1,
          product.product_id,
          dates[index % DAYS],
          quantity,
          product.unit_price_cents,
          region,
          status
        ].join(','))

        // Calculate the expected filtered join totals without DuckDB or SQL.
        // Integer cents avoid floating point differences between runtimes.
        if (status === 'completed') {
          const key = `${product.category}:${region}`
          let aggregate = totals.get(key)

          if (!aggregate) {
            aggregate = {
              category: product.category,
              region,
              order_count: 0,
              units: 0,
              revenue_cents: 0
            }
            totals.set(key, aggregate)
          }

          aggregate.order_count += 1
          aggregate.units += quantity
          aggregate.revenue_cents += quantity * product.unit_price_cents
        }
      }

      yield `${rows.join('\n')}\n`
    }
  }

  await fs.mkdir(DIRECTORY, { recursive: true })
  await fs.writeFile(sources[1]!.path, productRows())
  await fs.writeFile(sources[0]!.path, orderRows())

  const fixture = {
    orderCount: ORDER_COUNT,
    productCount: PRODUCT_COUNT,
    sources,
    expectedRows: [...totals.values()].sort((first, second) =>
      first.category.localeCompare(second.category) ||
      first.region.localeCompare(second.region)
    )
  }

  await fs.writeFile(
    path.join(DIRECTORY, 'expected.json'),
    // Versioned metadata must not change with the machine's checkout location.
    `${JSON.stringify({
      ...fixture,
      sources: sources.map((source) => ({
        ...source,
        path: path.basename(source.path)
      }))
    }, null, 2)}\n`
  )

  return fixture
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = await generateDuckDBFixtures()

  for (const source of fixture.sources) {
    const { size } = await fs.stat(source.path)

    console.info(`${source.path}: ${(size / 1_024 / 1_024).toFixed(1)} MiB`)
  }

  console.info(`Generated ${fixture.orderCount} orders and ${fixture.productCount} products.`)
}

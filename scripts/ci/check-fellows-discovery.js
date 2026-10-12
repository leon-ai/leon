import fs from 'node:fs/promises'
import path from 'node:path'

const CATALOG_URL = new URL('../../server/src/core/llm-manager/fellows/fellows.json', import.meta.url)
const REPORT_PATH = 'fellows-discovery-report.json'
const REQUEST_TIMEOUT_MS = 20_000
const REQUEST_ATTEMPTS = 2
const responses = new Map()

/**
 * Read public upstream evidence without executing any code from a fellow.
 */
async function readUpstream(url, { allowMissing = false } = {}) {
  if (!responses.has(url)) {
    responses.set(url, (async () => {
      let lastError

      for (let attempt = 0; attempt < REQUEST_ATTEMPTS; attempt += 1) {
        try {
          const headers = { 'user-agent': 'Leon-fellows-discovery' }

          if (url.startsWith('https://api.github.com/') && process.env.GITHUB_TOKEN) {
            headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
          }

          const response = await fetch(url, {
            headers,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
          })

          if (response.status === 404 && allowMissing) {
            return null
          }
          if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`)
          }

          return await response.text()
        } catch (error) {
          // Retry transient failures while preserving the final reason for review.
          lastError = error
        }
      }

      throw lastError
    })())
  }

  return responses.get(url)
}

/**
 * Inspect published behavior rather than unreleased development changes.
 * Repositories without published releases use their default branch.
 */
async function getUpstreamRevision(upstream) {
  const repositoryURL = `https://api.github.com/repos/${upstream}`
  const release = await readUpstream(`${repositoryURL}/releases/latest`, { allowMissing: true })
  const reference = release === null
    ? JSON.parse(await readUpstream(repositoryURL)).default_branch
    : JSON.parse(release).tag_name
  const commit = JSON.parse(await readUpstream(`${repositoryURL}/commits/${encodeURIComponent(reference)}`))

  return { reference, revision: commit.sha }
}

/**
 * Compare Leon's storage expectations with public upstream evidence.
 * Missing evidence prompts review; it cannot prove runtime incompatibility.
 */
async function checkFellow(fellow) {
  // Catalog mistakes must fail the checker rather than become upstream warnings.
  if (!fellow.checks.length) {
    throw new Error(`${fellow.label}: no upstream checks are configured.`)
  }

  const definitions = fellow.checks.map((check) => {
    let value = check.value ?? check.field.split('.').reduce((current, field) => current[field], fellow)
    const sourcePath = check.source === undefined ? fellow.documentation : fellow.sources[check.source]

    if (typeof value !== 'string' || !value || typeof sourcePath !== 'string' || !sourcePath) {
      throw new Error(`${fellow.label}: invalid upstream check for ${check.field || check.value}.`)
    }

    if (check.basename) {
      value = path.posix.basename(value)
    } else if (check.dirname) {
      value = path.posix.dirname(value)
    }

    return {
      field: check.field || check.value,
      expected: (check.template || '{value}').replace('{value}', value),
      sourcePath,
      documentation: check.source === undefined
    }
  })
  const checks = []
  let reference = ''
  let revision = ''

  try {
    ({ reference, revision } = await getUpstreamRevision(fellow.upstream))
  } catch (error) {
    checks.push({ field: 'repository', status: 'unavailable', error: error.message })
  }

  if (revision) {
    for (const check of definitions) {
      const source = check.documentation ? check.sourcePath
        : `https://raw.githubusercontent.com/${fellow.upstream}/${revision}/${check.sourcePath}`
      const details = { field: check.field, expected: check.expected, source }

      try {
        const content = await readUpstream(source)

        checks.push({
          ...details,
          status: content.includes(check.expected) ? 'verified' : 'changed-or-unverified'
        })
      } catch (error) {
        checks.push({ ...details, status: 'unavailable', error: error.message })
      }
    }
  }

  return {
    fellow: fellow.label,
    repository: fellow.upstream,
    reference,
    revision,
    status: checks.length && checks.every((check) => check.status === 'verified') ? 'verified' : 'needs-review',
    checks,
    ...(fellow.unverified ? { limitation: fellow.unverified } : {})
  }
}

const catalog = JSON.parse(await fs.readFile(CATALOG_URL, 'utf8'))
const report = await Promise.all(catalog.map(checkFellow))

await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n')

const summary = [
  '## Fellow discovery upstream checks',
  '',
  'These checks are advisory. Text matches confirm public evidence, not runtime compatibility.',
  'Sources use the latest published release, or the default branch when no release exists.',
  '',
  '| Fellow | Result | Upstream reference | Upstream revision |',
  '| --- | --- | --- | --- |',
  ...report.map((entry) =>
    `| ${entry.fellow} | ${entry.status} | ${entry.reference} | ${entry.revision.slice(0, 12)} |`
  ),
  '',
  ...report.flatMap((entry) => entry.checks
    .filter((check) => check.status !== 'verified')
    .map((check) =>
      `- ${entry.fellow}: ${check.field} (${check.status}). ${check.error ||
        `Expected \`${check.expected}\` in [upstream source](${check.source}).`}`
    )
  ),
  '',
  '### Known limitations',
  '',
  ...report.filter((entry) => entry.limitation).map((entry) => `- ${entry.fellow}: ${entry.limitation}`)
].join('\n') + '\n'

console.log(summary)

if (process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
}

// Upstream text and availability can change independently of Leon's runtime.
// Keep those signals visible without blocking otherwise working discovery.
for (const entry of report.filter((entry) => entry.status !== 'verified')) {
  console.warn(`::warning::${entry.fellow}: upstream evidence needs review. See the discovery report.`)
}

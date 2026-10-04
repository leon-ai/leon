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
async function readUpstream(url) {
  if (!responses.has(url)) {
    responses.set(url, (async () => {
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
          if (response.ok) {
            return await response.text()
          }
        } catch {
          // A second request handles transient upstream/network failures.
        }
      }
      throw new Error('I could not read the upstream source.')
    })())
  }
  return responses.get(url)
}

/**
 * Compare registry values with their authoritative source declarations/docs.
 * Missing evidence is a review signal, never permission to update paths blindly.
 */
async function checkFellow(fellow) {
  const checks = []
  let revision = ''

  try {
    const repository = JSON.parse(await readUpstream(`https://api.github.com/repos/${fellow.upstream}`))
    const commit = JSON.parse(await readUpstream(`https://api.github.com/repos/${fellow.upstream}/commits/${repository.default_branch}`))
    revision = commit.sha

    for (const check of fellow.checks) {
      const source = check.source === undefined ? fellow.documentation
        : `https://raw.githubusercontent.com/${fellow.upstream}/${revision}/${fellow.sources[check.source]}`
      let value = check.value ?? check.field.split('.').reduce((current, field) => current[field], fellow)
      if (check.basename) {
        value = path.posix.basename(value)
      } else if (check.dirname) {
        value = path.posix.dirname(value)
      }
      const expected = (check.template || '{value}').replace('{value}', value)

      try {
        const content = await readUpstream(source)
        checks.push({
          field: check.field || check.value,
          expected,
          source,
          status: content.includes(expected) ? 'verified' : 'changed-or-unverified'
        })
      } catch {
        checks.push({ field: check.field || check.value, expected, source, status: 'unavailable' })
      }
    }
  } catch {
    checks.push({ field: 'repository', status: 'unavailable' })
  }

  return {
    fellow: fellow.label,
    repository: fellow.upstream,
    revision,
    status: checks.length && checks.every((check) => check.status === 'verified') ? 'verified' : 'needs-review',
    checks,
    ...(fellow.unverified ? { limitation: fellow.unverified } : {})
  }
}

const catalog = JSON.parse(await fs.readFile(CATALOG_URL, 'utf8'))
const report = await Promise.all(catalog.map(checkFellow))
await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n')
const summary = ['## Fellow discovery upstream checks', '',
  '| Fellow | Result | Upstream revision |', '| --- | --- | --- |',
  ...report.map((entry) => `| ${entry.fellow} | ${entry.status} | ${entry.revision.slice(0, 12)} |`), '',
  ...report.flatMap((entry) => [
    ...entry.checks.filter((check) => check.status !== 'verified').map((check) =>
      `- ${entry.fellow}: ${check.field} (${check.status}). See the report for the source and expected value.`),
    ...(entry.limitation ? [`- ${entry.fellow}: ${entry.limitation}`] : [])
  ])].join('\n') + '\n'

console.log(summary)
if (process.env.GITHUB_STEP_SUMMARY) {
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
}
if (report.some((entry) => entry.status !== 'verified')) {
  process.exitCode = 1
}

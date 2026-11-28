import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const THEMES = ['light', 'dark']
const STREAM = 'sc-neon-glow-stream'
const CHART_NAME = 'star-history'

function labelChartYears(svg, path) {
  const endYear = svg.match(/<desc\b[^>]*>[^<]*\b\d{4}-\d{2}-\d{2} to (\d{4})-\d{2}-\d{2}\./)?.[1]
  const axisEnd = svg.match(/<g class="sc-x-axis"><line\b[^>]* x2="(\d+(?:\.\d+)?)"/)?.[1]
  const dates = svg.match(/<g class="sc-dates">([^]*?)<\/g>/)
  const ticks = [...(dates?.[1] ?? '').matchAll(/<text x="([^"]+)"([^<]+?) text-anchor="middle">[A-Za-z]{3} (\d{4})<\/text>/g)]
  const lastTick = ticks.at(-1)

  if (!endYear || !axisEnd || !dates || !lastTick || ticks.map((tick) => tick[0]).join('') !== dates[1]) {
    throw new Error(`Could not locate the Star Chart year labels: ${path}`)
  }

  // Keep the original spacing, reserving the rightmost label for the actual end year.
  const years = new Set([endYear])
  const labels = []
  for (const [, x, attributes, year] of ticks.slice(0, -1)) {
    if (!years.has(year)) {
      labels.push(`<text x="${x}"${attributes} text-anchor="middle">${year}</text>`)
      years.add(year)
    }
  }
  labels.push(`<text x="${axisEnd}"${lastTick[2]} text-anchor="end">${endYear}</text>`)

  return svg.replace(dates[0], `<g class="sc-dates">${labels.join('')}</g>`)
}

function styleChart(svg, path) {
  // Match the pinned renderer's named layers rather than changing the chart geometry.
  const halo = new RegExp(
    `<g filter="url\\(#${STREAM}-halo\\)"[^>]*><path data-chart="neon-halo"[^>]*/>(?:<circle[^>]*/>)?</g>`,
    'g'
  )
  const aura = /<g opacity="0\.2"><path data-chart="neon-aura"[^>]*\/><\/g>/g
  const filter = new RegExp(`<filter id="${STREAM}-halo"[^>]*><feGaussianBlur[^>]*/></filter>`, 'g')
  const forcedTextWidth = / textLength="[^"]+" lengthAdjust="spacingAndGlyphs"/g

  if (
    [halo, aura, filter].some((layer) => [...svg.matchAll(layer)].length !== 1) ||
    ![...svg.matchAll(forcedTextWidth)].length
  ) {
    throw new Error(`Unexpected Star Chart SVG layout: ${path}`)
  }

  const styled = svg.replace(halo, '').replace(aura, '').replace(filter, '').replace(forcedTextWidth, '')

  if (
    !styled.includes('data-chart="neon-glow-stream"') ||
    !styled.includes(`fill="url(#${STREAM}-stream)"`) ||
    !styled.includes(`<linearGradient id="${STREAM}-stream"`) ||
    !/--sc-l4:#1c75db;/i.test(styled) ||
    /\b(?:textLength|lengthAdjust|filter)=|neon-(?:halo|aura)/.test(styled)
  ) {
    throw new Error(`Star Chart styling could not be verified: ${path}`)
  }

  // The action hides the headline count, but still adds exact counts to these SVG annotations.
  const chart = labelChartYears(styled, path)
    .replace(/(<desc\b[^>]*>[^<]*?) [\d,]+ current stars\. [\d,]+ recorded additions in range\./, '$1')
    .replace(/<circle\b[^>]* fill="transparent"><title>[^<]* recorded stars at bucket end[^<]*<\/title><\/circle>/g, '')

  if (/class="[^"]*\bsc-total\b|\d current stars\.|\d recorded additions in range\.|recorded stars at bucket end/.test(chart)) {
    throw new Error(`Unexpected exact star counts in chart: ${path}`)
  }

  return chart.endsWith('\n') ? chart : `${chart}\n`
}

const [directory] = process.argv.slice(2)
if (!directory) {
  throw new Error('Usage: node scripts/ci/style-star-history.js <chart-directory>')
}

// Validate both charts before writing either one.
const charts = await Promise.all(THEMES.map(async (theme) => {
  const path = join(directory, `${CHART_NAME}-${theme}.svg`)
  return { path, svg: styleChart(await readFile(path, 'utf8'), path) }
}))

await Promise.all(charts.map(({ path, svg }) => writeFile(path, svg)))
